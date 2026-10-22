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
