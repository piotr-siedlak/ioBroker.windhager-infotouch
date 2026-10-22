"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanSystem = scanSystem;
const errors_1 = require("../api/errors");
const parsers_1 = require("../api/parsers");
const Datapoint_1 = require("../models/Datapoint");
/** Errors that mean "the controller is unreachable or refuses us": abort instead of producing a partial catalog. */
function isFatal(err) {
    return (err instanceof errors_1.WindhagerError && (err.kind === 'auth' || err.kind === 'connection' || err.kind === 'timeout'));
}
/**
 * Walk modules, functions and lookup groups and build a catalog. Read-only: GET requests only.
 * Functions flagged as locked by the controller are listed but not read, to respect its access model.
 *
 * @param api Read-only controller API
 * @param options Scan options
 */
async function scanSystem(api, options) {
    const log = options.log ?? (() => undefined);
    const controller = await api.getControllerInfo().catch(err => {
        if (isFatal(err)) {
            throw err;
        }
        return { device: null, version: null };
    });
    const moduleItems = await api.listModules();
    const modules = [];
    let skipped = 0;
    for (const item of moduleItems) {
        const module = { ...item, functions: [] };
        modules.push(module);
        if (options.excludedNodes.has(item.nodeId)) {
            log(`Module ${item.nodeId} excluded by configuration`);
            continue;
        }
        let functions;
        try {
            functions = await api.listFunctions(item.nodeId);
        }
        catch (err) {
            if (isFatal(err)) {
                throw err;
            }
            skipped++;
            log(`Module ${item.nodeId}: function list unavailable (${err.message})`);
            continue;
        }
        for (const fn of functions) {
            const info = { ...fn, lookups: [] };
            module.functions.push(info);
            if (fn.locked) {
                continue;
            }
            let lookups;
            try {
                lookups = await api.listLookups(item.nodeId, fn.fctId);
            }
            catch (err) {
                if (isFatal(err)) {
                    throw err;
                }
                skipped++;
                continue;
            }
            for (const lookup of lookups) {
                try {
                    const group = await api.readGroup(item.nodeId, fn.fctId, lookup.id, lookup.count);
                    skipped += group.skipped;
                    info.lookups.push({
                        nodeId: item.nodeId,
                        fctId: fn.fctId,
                        lookupId: lookup.id,
                        count: lookup.count,
                        key: (0, parsers_1.groupKey)(item.nodeId, fn.fctId, lookup.id),
                        datapoints: group.datapoints,
                        lon: options.includeLon ? group.lon : [],
                    });
                }
                catch (err) {
                    if (isFatal(err)) {
                        throw err;
                    }
                    skipped++;
                    log(`Group ${(0, parsers_1.groupKey)(item.nodeId, fn.fctId, lookup.id)} skipped: ${err.message}`);
                }
            }
        }
    }
    return {
        schemaVersion: Datapoint_1.CATALOG_SCHEMA_VERSION,
        discoveredAt: Date.now(),
        controller,
        signature: (0, Datapoint_1.moduleSignature)(modules),
        modules,
        skipped,
        scanOptions: (0, Datapoint_1.scanFingerprint)(options),
    };
}
