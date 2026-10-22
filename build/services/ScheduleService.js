"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SCHEDULE_TYPE_ID = void 0;
exports.findScheduleDatapoints = findScheduleDatapoints;
exports.readSchedules = readSchedules;
/** Type id observed on time-program objects in recorded community data. Hypothesis, see RESEARCH.md. */
exports.SCHEDULE_TYPE_ID = 30;
function findScheduleDatapoints(catalog) {
    const out = [];
    for (const module of catalog.modules) {
        for (const fn of module.functions) {
            for (const group of fn.lookups) {
                out.push(...group.datapoints.filter(dp => dp.typeId === exports.SCHEDULE_TYPE_ID));
            }
        }
    }
    return out;
}
/**
 * Read-only schedule reader. It stores the controller's payload verbatim; interpreting weekdays, switch
 * points, timezone and DST is deferred until real-device payloads are verified. There is no write path.
 *
 * @param api Controller API
 * @param catalog Current catalog
 */
async function readSchedules(api, catalog) {
    const out = [];
    for (const dp of findScheduleDatapoints(catalog)) {
        try {
            const payload = await api.readObject(dp.oid);
            out.push({ key: dp.key, oid: dp.oid, name: dp.name, json: JSON.stringify(payload) });
        }
        catch {
            // Some firmwares answer 409 for objects that are not currently readable; skip those silently.
        }
    }
    return out;
}
