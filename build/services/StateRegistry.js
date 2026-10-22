"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StateRegistry = exports.Q_GOOD = exports.Q_STALE = void 0;
const CapabilityRegistry_1 = require("../discovery/CapabilityRegistry");
const StateRoles_1 = require("../mappings/StateRoles");
/** Quality flag: device/instance not connected. Used to mark values stale instead of deleting them. */
exports.Q_STALE = 0x42;
exports.Q_GOOD = 0;
const STATE_PREFIXES = ['modules.', 'raw.', 'lon.'];
const slug = (key) => key.replace(/\./g, '_');
class StateRegistry {
    port;
    options;
    entries = new Map();
    idToOid = new Map();
    lastValues = new Map();
    constructor(port, options) {
        this.port = port;
        this.options = options;
    }
    /** Relative state id for a datapoint. Based only on native numeric identifiers. */
    static stateId(dp) {
        return `modules.node_${dp.nodeId}.fn_${dp.fctId}.grp_${dp.lookupId}.dp_${dp.memberId}_${dp.instance}`;
    }
    static lonStateId(nv) {
        return `lon.node_${nv.nodeId}.fn_${nv.fctId}.grp_${nv.lookupId}.nv_${nv.index}`;
    }
    /** Whether a datapoint will be exposed as writable: controller flag AND global switch AND allow-list. */
    isExposedWritable(dp) {
        return this.options.writesEnabled && (0, CapabilityRegistry_1.isWritableByController)(dp) && this.options.writeAllowlist.has(dp.oid);
    }
    oidForState(relativeId) {
        return this.idToOid.get(relativeId);
    }
    writableStateFor(oid) {
        const entry = this.entries.get(oid);
        return entry?.writable ? entry.id : undefined;
    }
    /**
     * Create/update objects for the whole catalog and mark objects no longer in it as stale.
     * Existing historic objects are never deleted.
     *
     * @param catalog Current catalog
     */
    async sync(catalog) {
        const seen = new Set();
        let datapoints = 0;
        // Snapshot before objects are rewritten: updating an object resets its stale flag.
        const previouslyStale = await this.collectStale();
        for (const module of catalog.modules) {
            const nodeId = `modules.node_${module.nodeId}`;
            await this.port.extendObject(nodeId, {
                type: 'device',
                common: { name: module.name },
                native: { nodeId: module.nodeId, group: module.group, subnet: module.subnet },
            });
            for (const fn of module.functions) {
                const fnId = `${nodeId}.fn_${fn.fctId}`;
                await this.port.extendObject(fnId, {
                    type: 'channel',
                    common: { name: fn.name || `Function ${fn.fctId}` },
                    native: { fctId: fn.fctId, fctType: fn.fctType, locked: fn.locked },
                });
                for (const group of fn.lookups) {
                    await this.port.extendObject(`${fnId}.grp_${group.lookupId}`, {
                        type: 'channel',
                        common: { name: `Group ${group.lookupId}` },
                        native: { lookupId: group.lookupId, count: group.count },
                    });
                    for (const dp of group.datapoints) {
                        await this.ensureDatapoint(dp);
                        seen.add(dp.key);
                        datapoints++;
                    }
                    if (this.options.includeLon) {
                        for (const nv of group.lon) {
                            await this.ensureLon(nv);
                            seen.add(nv.key);
                        }
                    }
                }
            }
        }
        const { stale, revived } = await this.markStale(seen, previouslyStale);
        return { datapoints, stale, revived };
    }
    async ensureDatapoint(dp) {
        const writable = this.isExposedWritable(dp);
        const shape = (0, StateRoles_1.shapeFor)(dp, writable);
        const id = StateRegistry.stateId(dp);
        await this.port.extendObject(id, {
            type: 'state',
            common: {
                name: dp.name || `OID ${dp.oid}`,
                type: shape.type,
                role: shape.role,
                read: true,
                write: writable,
                ...(shape.unit ? { unit: shape.unit } : {}),
                ...(shape.min !== undefined ? { min: shape.min, max: shape.max } : {}),
                ...(shape.step !== undefined ? { step: shape.step } : {}),
                ...(shape.states ? { states: shape.states } : {}),
            },
            native: {
                key: dp.key,
                oid: dp.oid,
                typeId: dp.typeId,
                subtypeId: dp.subtypeId,
                unitId: dp.unitId,
                writeProtected: dp.writeProtected,
                stale: false,
            },
        });
        this.entries.set(dp.oid, { id, type: shape.type, writable });
        this.idToOid.set(id, dp.oid);
        if (this.options.exposeRaw) {
            await this.port.extendObject(`raw.${slug(dp.key)}`, {
                type: 'state',
                common: { name: `RAW ${dp.oid}`, type: 'string', role: 'text', read: true, write: false },
                native: { key: dp.key, oid: dp.oid, stale: false },
            });
        }
    }
    async ensureLon(nv) {
        await this.port.extendObject(StateRegistry.lonStateId(nv), {
            type: 'state',
            common: {
                name: nv.name,
                type: 'string',
                role: 'text',
                read: true,
                write: false,
                ...(nv.unit ? { unit: nv.unit } : {}),
            },
            // The SNVT type stays as reported; values are not reinterpreted until a verified mapping exists.
            native: { key: nv.key, snvtName: nv.snvtName, snvtIndex: nv.snvtIndex, stale: false },
        });
    }
    async collectStale() {
        const stale = new Set();
        for (const prefix of STATE_PREFIXES) {
            for (const obj of await this.port.listObjects(prefix)) {
                if (obj.type === 'state' && typeof obj.native.key === 'string' && obj.native.stale === true) {
                    stale.add(obj.native.key);
                }
            }
        }
        return stale;
    }
    async markStale(seen, previouslyStale) {
        let stale = 0;
        for (const prefix of STATE_PREFIXES) {
            for (const obj of await this.port.listObjects(prefix)) {
                const key = obj.native.key;
                if (obj.type !== 'state' || typeof key !== 'string') {
                    continue;
                }
                if (!seen.has(key) && obj.native.stale !== true) {
                    await this.port.extendObject(obj.id, { type: 'state', native: { stale: true } });
                    await this.port.setStateChanged(obj.id, { val: null, ack: true, q: exports.Q_STALE });
                    stale++;
                }
            }
        }
        const revived = [...previouslyStale].filter(key => seen.has(key)).length;
        return { stale, revived };
    }
    /**
     * Publish values. Uses change-aware writes so unchanged values do not touch the database.
     *
     * @param datapoints Freshly read datapoints
     */
    async applyValues(datapoints) {
        for (const dp of datapoints) {
            const entry = this.entries.get(dp.oid);
            if (!entry) {
                continue; // not in catalog (appeared after discovery); picked up on next rescan
            }
            const val = (0, StateRoles_1.coerceValue)(dp.value, entry.type);
            this.lastValues.set(entry.id, val);
            await this.port.setStateChanged(entry.id, { val, ack: true, q: exports.Q_GOOD });
            if (this.options.exposeRaw) {
                await this.port.setStateChanged(`raw.${slug(dp.key)}`, { val: dp.value, ack: true, q: exports.Q_GOOD });
            }
        }
    }
    async applyLonValues(variables) {
        for (const nv of variables) {
            await this.port.setStateChanged(StateRegistry.lonStateId(nv), { val: nv.value, ack: true, q: exports.Q_GOOD });
        }
    }
    /**
     * Flag every state we have published as stale (controller offline) while keeping its last value.
     * The next successful poll rewrites each value with good quality.
     */
    async markAllStale() {
        for (const [id, val] of this.lastValues) {
            await this.port.setStateChanged(id, { val, ack: true, q: exports.Q_STALE });
        }
    }
    stateIds() {
        return [...this.entries.values()].map(e => e.id);
    }
    typeOf(oid) {
        return this.entries.get(oid)?.type;
    }
}
exports.StateRegistry = StateRegistry;
