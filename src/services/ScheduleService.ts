import type { ControllerApi } from '../api/ControllerApi';
import type { Catalog, Datapoint } from '../models/Datapoint';

/** Type id observed on time-program objects in recorded community data. Hypothesis, see RESEARCH.md. */
export const SCHEDULE_TYPE_ID = 30;

export interface ScheduleSnapshot {
    key: string;
    oid: string;
    name: string;
    /** Unmodified JSON from the controller. Unknown fields are preserved because nothing is re-encoded. */
    json: string;
}

export function findScheduleDatapoints(catalog: Catalog): Datapoint[] {
    const out: Datapoint[] = [];
    for (const module of catalog.modules) {
        for (const fn of module.functions) {
            for (const group of fn.lookups) {
                out.push(...group.datapoints.filter(dp => dp.typeId === SCHEDULE_TYPE_ID));
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
export async function readSchedules(api: ControllerApi, catalog: Catalog): Promise<ScheduleSnapshot[]> {
    const out: ScheduleSnapshot[] = [];
    for (const dp of findScheduleDatapoints(catalog)) {
        try {
            const payload = await api.readObject(dp.oid);
            out.push({ key: dp.key, oid: dp.oid, name: dp.name, json: JSON.stringify(payload) });
        } catch {
            // Some firmwares answer 409 for objects that are not currently readable; skip those silently.
        }
    }
    return out;
}
