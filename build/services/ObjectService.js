"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OBJECT_TYPE_ID = void 0;
exports.findObjectDatapoints = findObjectDatapoints;
exports.readObjects = readObjects;
const parsers_1 = require("../api/parsers");
/** Structured objects: subtype 9 = text (versions, names), subtype 14 = time program (verified on MB6621 0.10.4). */
exports.OBJECT_TYPE_ID = 30;
function findObjectDatapoints(catalog) {
    const seen = new Map();
    for (const module of catalog.modules) {
        for (const fn of module.functions) {
            for (const group of fn.lookups) {
                for (const dp of group.datapoints) {
                    if (dp.typeId === exports.OBJECT_TYPE_ID) {
                        seen.set(dp.oid, dp);
                    }
                }
            }
        }
    }
    return [...seen.values()];
}
/**
 * Read-only reader for structured objects. Time programs are stored verbatim (unknown fields preserved);
 * interpretation and writing are out of scope until verified. Objects that answer with an error (e.g. 409 for
 * time programs of inactive functions) are skipped.
 *
 * @param api Controller API
 * @param catalog Current catalog
 */
async function readObjects(api, catalog) {
    const out = [];
    for (const dp of findObjectDatapoints(catalog)) {
        try {
            const payload = await api.readObject(dp.oid);
            const value = (0, parsers_1.isRecord)(payload) ? payload.value : undefined;
            if (value === undefined) {
                continue;
            }
            out.push({ oid: dp.oid, value: typeof value === 'string' ? value.trim() : JSON.stringify(value) });
        }
        catch {
            // not readable right now
        }
    }
    return out;
}
