import { isWritableByController } from '../discovery/CapabilityRegistry';
import { displayCode } from '../api/parsers';
import { OBJECT_TYPE_ID } from './ObjectService';
import { coerceValue, shapeFor, type StateKind } from '../mappings/StateRoles';
import type { Catalog, Datapoint, LonVariable } from '../models/Datapoint';

/** Quality flag: device/instance not connected. Used to mark values stale instead of deleting them. */
export const Q_STALE = 0x42;
export const Q_GOOD = 0;

/** Narrow view of the adapter so the registry is testable without a js-controller. All ids are relative. */
export interface AdapterPort {
    extendObject(
        id: string,
        obj: { type: string; common?: Record<string, unknown>; native?: Record<string, unknown> },
    ): Promise<void>;
    setStateChanged(
        id: string,
        state: { val: string | number | boolean | null; ack: boolean; q?: number },
    ): Promise<void>;
    /** All objects whose relative id starts with `prefix`. */
    listObjects(prefix: string): Promise<Array<{ id: string; type: string; native: Record<string, unknown> }>>;
}

export interface RegistryOptions {
    writesEnabled: boolean;
    writeAllowlist: ReadonlySet<string>;
    exposeRaw: boolean;
    includeLon: boolean;
}

export interface SyncResult {
    datapoints: number;
    stale: number;
    revived: number;
}

interface Entry {
    id: string;
    type: StateKind;
    writable: boolean;
}

const STATE_PREFIXES = ['modules.', 'raw.', 'lon.'];

const slug = (key: string): string => key.replace(/\./g, '_');

export class StateRegistry {
    private readonly entries = new Map<string, Entry>();
    private readonly idToOid = new Map<string, string>();
    private readonly lastValues = new Map<string, string | number | null>();

    public constructor(
        private readonly port: AdapterPort,
        private readonly options: RegistryOptions,
    ) {}

    /** Module segment; the subnet is only added when it is not the usual subnet 1. */
    public static nodeSegment(subnet: number, nodeId: number): string {
        return subnet === 1 ? `node_${nodeId}` : `node_${subnet}_${nodeId}`;
    }

    /**
     * Relative state id for a datapoint, built only from its OID: `modules.node_15.fn_0.03-051` uses the controller's
     * own display code (group-member), so ids match what the controller shows and never depend on names or menus.
     */
    public static stateId(
        dp: Pick<Datapoint, 'subnet' | 'nodeId' | 'fctId' | 'groupNr' | 'memberNr' | 'instance'>,
    ): string {
        const inst = dp.instance === 0 ? '' : `_${dp.instance}`;
        return `modules.${StateRegistry.nodeSegment(dp.subnet, dp.nodeId)}.fn_${dp.fctId}.${displayCode(dp)}${inst}`;
    }

    public static lonStateId(nv: Pick<LonVariable, 'nodeId' | 'index'>): string {
        return `lon.node_${nv.nodeId}.nv_${nv.index}`;
    }

    /** Whether a datapoint will be exposed as writable: controller flag AND global switch AND allow-list. */
    public isExposedWritable(dp: Datapoint): boolean {
        return this.options.writesEnabled && isWritableByController(dp) && this.options.writeAllowlist.has(dp.oid);
    }

    public oidForState(relativeId: string): string | undefined {
        return this.idToOid.get(relativeId);
    }

    public writableStateFor(oid: string): string | undefined {
        const entry = this.entries.get(oid);
        return entry?.writable ? entry.id : undefined;
    }

    /**
     * Create/update objects for the whole catalog and mark objects no longer in it as stale.
     * Existing historic objects are never deleted.
     *
     * @param catalog Current catalog
     */
    public async sync(catalog: Catalog): Promise<SyncResult> {
        const seen = new Set<string>();
        let datapoints = 0;
        // Snapshot before objects are rewritten: updating an object resets its stale flag.
        const previouslyStale = await this.collectStale();

        for (const module of catalog.modules) {
            const nodeId = `modules.${StateRegistry.nodeSegment(module.subnet, module.nodeId)}`;
            await this.port.extendObject(nodeId, {
                type: 'device',
                common: { name: module.label ?? `Module ${module.nodeId}` },
                native: { nodeId: module.nodeId, group: module.group, subnet: module.subnet },
            });
            for (const fn of module.functions) {
                const fnId = `${nodeId}.fn_${fn.fctId}`;
                await this.port.extendObject(fnId, {
                    type: 'channel',
                    common: { name: fn.label ?? `Function ${fn.fctId} (type ${fn.fctType})` },
                    native: { fctId: fn.fctId, fctType: fn.fctType, locked: fn.locked },
                });
                for (const group of fn.lookups) {
                    for (const dp of group.datapoints) {
                        await this.ensureDatapoint(dp, group.key);
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

    private async ensureDatapoint(dp: Datapoint, groupKey: string): Promise<void> {
        const writable = this.isExposedWritable(dp);
        const shape = shapeFor(dp, writable);
        const id = StateRegistry.stateId(dp);
        await this.port.extendObject(id, {
            type: 'state',
            common: {
                name: dp.label ?? `${displayCode(dp)}${dp.levelLabel ? ` (${dp.levelLabel})` : ''}`,
                desc: `${displayCode(dp)} · ${dp.oid}${dp.levelLabel ? ` · ${dp.levelLabel}` : ''}`,
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
                code: displayCode(dp),
                /** Poll group key: use it in "Groups polled fast". */
                group: groupKey,
                levelId: dp.levelId,
                nativeName: dp.name,
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

    private async ensureLon(nv: LonVariable): Promise<void> {
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

    private async collectStale(): Promise<Set<string>> {
        const stale = new Set<string>();
        for (const prefix of STATE_PREFIXES) {
            for (const obj of await this.port.listObjects(prefix)) {
                if (obj.type === 'state' && typeof obj.native.key === 'string' && obj.native.stale === true) {
                    stale.add(obj.native.key);
                }
            }
        }
        return stale;
    }

    private async markStale(
        seen: ReadonlySet<string>,
        previouslyStale: ReadonlySet<string>,
    ): Promise<{ stale: number; revived: number }> {
        let stale = 0;
        for (const prefix of STATE_PREFIXES) {
            for (const obj of await this.port.listObjects(prefix)) {
                const key = obj.native.key;
                if (obj.type !== 'state' || typeof key !== 'string') {
                    continue;
                }
                if (!seen.has(key) && obj.native.stale !== true) {
                    await this.port.extendObject(obj.id, { type: 'state', native: { stale: true } });
                    await this.port.setStateChanged(obj.id, { val: null, ack: true, q: Q_STALE });
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
    public async applyValues(datapoints: Datapoint[]): Promise<void> {
        for (const dp of datapoints) {
            const entry = this.entries.get(dp.oid);
            if (!entry) {
                continue; // not in catalog (appeared after discovery); picked up on next rescan
            }
            if (dp.typeId === OBJECT_TYPE_ID) {
                continue; // structured objects carry no value in lookups; published by the object reader
            }
            const val = coerceValue(dp.value, entry.type);
            this.lastValues.set(entry.id, val);
            await this.port.setStateChanged(entry.id, { val, ack: true, q: Q_GOOD });
            if (this.options.exposeRaw) {
                await this.port.setStateChanged(`raw.${slug(dp.key)}`, { val: dp.value, ack: true, q: Q_GOOD });
            }
        }
    }

    /**
     * Publish the value of a structured object (read separately via /api/1.0/object).
     *
     * @param oid Object OID
     * @param value Text or JSON
     */
    public async applyObjectValue(oid: string, value: string): Promise<void> {
        const entry = this.entries.get(oid);
        if (entry) {
            await this.port.setStateChanged(entry.id, { val: value, ack: true, q: Q_GOOD });
        }
    }

    public async applyLonValues(variables: LonVariable[]): Promise<void> {
        for (const nv of variables) {
            await this.port.setStateChanged(StateRegistry.lonStateId(nv), { val: nv.value, ack: true, q: Q_GOOD });
        }
    }

    /**
     * Flag every state we have published as stale (controller offline) while keeping its last value.
     * The next successful poll rewrites each value with good quality.
     */
    public async markAllStale(): Promise<void> {
        for (const [id, val] of this.lastValues) {
            await this.port.setStateChanged(id, { val, ack: true, q: Q_STALE });
        }
    }

    public stateIds(): string[] {
        return [...this.entries.values()].map(e => e.id);
    }

    public typeOf(oid: string): StateKind | undefined {
        return this.entries.get(oid)?.type;
    }
}
