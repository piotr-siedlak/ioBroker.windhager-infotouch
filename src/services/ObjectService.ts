import type { ControllerApi } from '../api/ControllerApi';
import { isRecord } from '../api/parsers';
import type { Catalog, Datapoint } from '../models/Datapoint';

/** Structured objects: subtype 9 = text (versions, names), subtype 14 = time program (verified on MB6621 0.10.4). */
export const OBJECT_TYPE_ID = 30;

export interface ObjectSnapshot {
    oid: string;
    /** Text for text objects, otherwise the unmodified JSON of the `value` field. */
    value: string;
}

export function findObjectDatapoints(catalog: Catalog): Datapoint[] {
    const seen = new Map<string, Datapoint>();
    for (const module of catalog.modules) {
        for (const fn of module.functions) {
            for (const group of fn.lookups) {
                for (const dp of group.datapoints) {
                    if (dp.typeId === OBJECT_TYPE_ID) {
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
export async function readObjects(api: ControllerApi, catalog: Catalog): Promise<ObjectSnapshot[]> {
    const out: ObjectSnapshot[] = [];
    for (const dp of findObjectDatapoints(catalog)) {
        try {
            const payload = await api.readObject(dp.oid);
            const value = isRecord(payload) ? payload.value : undefined;
            if (value === undefined) {
                continue;
            }
            out.push({ oid: dp.oid, value: typeof value === 'string' ? value.trim() : JSON.stringify(value) });
        } catch {
            // not readable right now
        }
    }
    return out;
}
