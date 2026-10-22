import type { ControllerApi } from '../api/ControllerApi';
import { WindhagerError } from '../api/errors';
import { groupKey } from '../api/parsers';
import {
    CATALOG_SCHEMA_VERSION,
    moduleSignature,
    scanFingerprint,
    type Catalog,
    type FunctionInfo,
    type ModuleInfo,
} from '../models/Datapoint';

export interface ScanOptions {
    /** Node IDs the user excluded from discovery. */
    excludedNodes: ReadonlySet<number>;
    /** Read LON variable lists too (structure only, no per-variable values). */
    includeLon: boolean;
    /** Text language, only recorded in the cache fingerprint here. */
    language?: string;
    log?: (message: string) => void;
}

/** Errors that mean "the controller is unreachable or refuses us": abort instead of producing a partial catalog. */
function isFatal(err: unknown): boolean {
    return (
        err instanceof WindhagerError && (err.kind === 'auth' || err.kind === 'connection' || err.kind === 'timeout')
    );
}

/**
 * Walk modules, functions and lookup groups and build a catalog. Read-only: GET requests only.
 * Functions flagged as locked by the controller are listed but not read, to respect its access model.
 *
 * @param api Read-only controller API
 * @param options Scan options
 */
export async function scanSystem(api: ControllerApi, options: ScanOptions): Promise<Catalog> {
    const log = options.log ?? ((): void => undefined);
    const controller = await api.getControllerInfo().catch(err => {
        if (isFatal(err)) {
            throw err;
        }
        return { device: null, version: null };
    });
    const moduleItems = await api.listModules();
    const modules: ModuleInfo[] = [];
    let skipped = 0;

    for (const item of moduleItems) {
        const module: ModuleInfo = { ...item, functions: [] };
        modules.push(module);
        if (options.excludedNodes.has(item.nodeId)) {
            log(`Module ${item.nodeId} excluded by configuration`);
            continue;
        }
        let functions;
        try {
            functions = await api.listFunctions(item.nodeId);
        } catch (err) {
            if (isFatal(err)) {
                throw err;
            }
            skipped++;
            log(`Module ${item.nodeId}: function list unavailable (${(err as Error).message})`);
            continue;
        }
        for (const fn of functions) {
            const info: FunctionInfo = { ...fn, lookups: [] };
            module.functions.push(info);
            if (fn.locked) {
                continue;
            }
            let lookups;
            try {
                lookups = await api.listLookups(item.nodeId, fn.fctId);
            } catch (err) {
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
                        key: groupKey(item.nodeId, fn.fctId, lookup.id),
                        datapoints: group.datapoints,
                        lon: options.includeLon ? group.lon : [],
                    });
                } catch (err) {
                    if (isFatal(err)) {
                        throw err;
                    }
                    skipped++;
                    log(`Group ${groupKey(item.nodeId, fn.fctId, lookup.id)} skipped: ${(err as Error).message}`);
                }
            }
        }
    }

    skipped += await addCachedDatapoints(api, modules, options, log);

    return {
        schemaVersion: CATALOG_SCHEMA_VERSION,
        discoveredAt: Date.now(),
        controller,
        signature: moduleSignature(modules),
        modules,
        skipped,
        scanOptions: scanFingerprint(options),
    };
}

/** Lookup id of the synthetic group holding datapoints that are polled one by one (not listed in any menu). */
export const DIRECT_GROUP_ID = -1;

/**
 * Add datapoints that only the controller's cache knows (main-screen values such as actual room temperature,
 * time programs) to their function, in a synthetic group polled per datapoint. Only for discovered, unlocked,
 * non-excluded functions. Failure is not fatal: the cache endpoint is optional.
 */
async function addCachedDatapoints(
    api: ControllerApi,
    modules: ModuleInfo[],
    options: ScanOptions,
    log: (message: string) => void,
): Promise<number> {
    let cached;
    try {
        cached = await api.readCachedDatapoints();
    } catch (err) {
        if (isFatal(err)) {
            throw err;
        }
        log(`Datapoint cache not available: ${(err as Error).message}`);
        return 0;
    }
    const known = new Set<string>();
    for (const m of modules) {
        for (const f of m.functions) {
            for (const g of f.lookups) {
                g.datapoints.forEach(d => known.add(d.oid));
            }
        }
    }
    let added = 0;
    for (const dp of cached) {
        if (known.has(dp.oid) || options.excludedNodes.has(dp.nodeId)) {
            continue;
        }
        const module = modules.find(m => m.nodeId === dp.nodeId && m.subnet === dp.subnet);
        const fn = module?.functions.find(f => f.fctId === dp.fctId);
        if (!module || !fn || fn.locked) {
            continue;
        }
        let group = fn.lookups.find(g => g.lookupId === DIRECT_GROUP_ID);
        if (!group) {
            group = {
                nodeId: dp.nodeId,
                fctId: dp.fctId,
                lookupId: DIRECT_GROUP_ID,
                count: 0,
                key: `n${dp.nodeId}.f${dp.fctId}.direct`,
                datapoints: [],
                lon: [],
            };
            fn.lookups.push(group);
        }
        group.datapoints.push({ ...dp, levelId: null });
        group.count = group.datapoints.length;
        known.add(dp.oid);
        added++;
    }
    log(`Added ${added} datapoint(s) known only from the controller cache`);
    return 0;
}
