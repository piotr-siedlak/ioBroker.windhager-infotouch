"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.indexCatalog = indexCatalog;
exports.isWritableByController = isWritableByController;
exports.categorize = categorize;
exports.isCacheValid = isCacheValid;
exports.summarize = summarize;
const Datapoint_1 = require("../models/Datapoint");
function indexCatalog(catalog) {
    const index = { datapoints: new Map(), byOid: new Map(), groups: new Map() };
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
function isWritableByController(dp) {
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
function categorize(group, fastGroups) {
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
 * @param current.scanOptions Discovery options of the running configuration
 * @param maxAgeMs Maximum cache age
 * @param now Current time
 */
function isCacheValid(cached, current, maxAgeMs, now = Date.now()) {
    if (!cached || cached.schemaVersion !== Datapoint_1.CATALOG_SCHEMA_VERSION) {
        return false;
    }
    if (now - cached.discoveredAt > maxAgeMs) {
        return false;
    }
    if (cached.controller.version !== current.version) {
        return false;
    }
    if (JSON.stringify(cached.scanOptions) !== JSON.stringify(current.scanOptions)) {
        return false;
    }
    return cached.signature === (0, Datapoint_1.moduleSignature)(current.modules);
}
function summarize(catalog) {
    const s = {
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
