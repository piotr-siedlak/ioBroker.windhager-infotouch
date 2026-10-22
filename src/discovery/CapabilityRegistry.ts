import {
    CATALOG_SCHEMA_VERSION,
    moduleSignature,
    type Catalog,
    type Datapoint,
    type LookupGroup,
} from '../models/Datapoint';

export type PollCategory = 'fast' | 'normal' | 'slow';

export interface CatalogIndex {
    datapoints: Map<string, Datapoint>;
    byOid: Map<string, Datapoint>;
    groups: Map<string, LookupGroup>;
}

export function indexCatalog(catalog: Catalog): CatalogIndex {
    const index: CatalogIndex = { datapoints: new Map(), byOid: new Map(), groups: new Map() };
    for (const module of catalog.modules) {
        for (const fn of module.functions) {
            for (const group of fn.lookups) {
                index.groups.set(group.key, group);
                for (const dp of group.datapoints) {
                    index.datapoints.set(dp.key, dp);
                    index.byOid.set(dp.oid, dp);
                }
            }
        }
    }
    return index;
}

/**
 * Whether the controller explicitly marks the datapoint as writable. Missing information means "not writable".
 *
 * @param dp Datapoint
 */
export function isWritableByController(dp: Datapoint): boolean {
    return dp.writeProtected === false;
}

/**
 * Heuristic poll category for a lookup group. Groups made only of write-protected points are measurements and
 * are polled at the normal rate; groups containing writable parameters are mostly settings and change rarely.
 * Users can override this with the fast-group list. LON groups are always slow.
 *
 * @param group Lookup group
 * @param fastGroups Group keys the user wants polled fast
 */
export function categorize(group: LookupGroup, fastGroups: ReadonlySet<string>): PollCategory {
    if (fastGroups.has(group.key)) {
        return 'fast';
    }
    if (group.datapoints.length === 0) {
        return 'slow';
    }
    return group.datapoints.some(isWritableByController) ? 'slow' : 'normal';
}

/**
 * Decide whether a cached catalog can still be used.
 *
 * @param cached Cached catalog
 * @param current Module identities and firmware version currently reported by the controller
 * @param current.modules Modules currently listed by the controller
 * @param current.version Firmware/API version currently reported
 * @param maxAgeMs Maximum cache age
 * @param now Current time
 */
export function isCacheValid(
    cached: Catalog | null,
    current: { modules: Array<{ nodeId: number; programId: string; neuronId: string }>; version: string | null },
    maxAgeMs: number,
    now = Date.now(),
): boolean {
    if (!cached || cached.schemaVersion !== CATALOG_SCHEMA_VERSION) {
        return false;
    }
    if (now - cached.discoveredAt > maxAgeMs) {
        return false;
    }
    if (cached.controller.version !== current.version) {
        return false;
    }
    return cached.signature === moduleSignature(current.modules);
}

export interface CapabilitySummary {
    modules: number;
    functions: number;
    groups: number;
    datapoints: number;
    writableByController: number;
    lonVariables: number;
}

export function summarize(catalog: Catalog): CapabilitySummary {
    const s: CapabilitySummary = {
        modules: catalog.modules.length,
        functions: 0,
        groups: 0,
        datapoints: 0,
        writableByController: 0,
        lonVariables: 0,
    };
    for (const module of catalog.modules) {
        s.functions += module.functions.length;
        for (const fn of module.functions) {
            s.groups += fn.lookups.length;
            for (const group of fn.lookups) {
                s.datapoints += group.datapoints.length;
                s.writableByController += group.datapoints.filter(isWritableByController).length;
                s.lonVariables += group.lon.length;
            }
        }
    }
    return s;
}
