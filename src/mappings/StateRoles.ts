import type { Datapoint } from '../models/Datapoint';
import { roleForUnit } from './Units';

export type StateKind = 'number' | 'string';

export interface StateShape {
    type: StateKind;
    role: string;
    unit?: string;
    min?: number;
    max?: number;
    step?: number;
    states?: Record<string, string>;
}

/**
 * Decide the ioBroker type/role for a datapoint from its metadata. The decision depends only on discovery
 * metadata (and, as a last resort, the discovery-time value) so that it stays stable across polls.
 *
 * @param dp Datapoint
 * @param writable Whether the resulting state will accept user writes
 */
export function shapeFor(dp: Datapoint, writable: boolean): StateShape {
    // Structured objects (typeId 30): text such as versions (subtype 9) or JSON such as time programs.
    if (dp.typeId === 30) {
        return { type: 'string', role: dp.subtypeId === 9 ? 'text' : 'json' };
    }
    const hasRange = dp.min !== null && dp.max !== null && dp.max > dp.min;
    // Dates/times (typeId 4, e.g. "22.10.2026", "14:54") are not numbers even though they have min/max strings.
    const numericValue = dp.value === null ? null : Number.isFinite(Number(dp.value));
    const isNumber =
        numericValue === true ||
        (numericValue === null &&
            (dp.enumValues !== null || dp.enumTexts !== undefined || dp.unit !== null || hasRange));
    if (!isNumber) {
        return { type: 'string', role: 'text' };
    }
    const states = enumStates(dp);
    const shape: StateShape = {
        type: 'number',
        role: states ? (writable ? 'level' : 'value') : roleForUnit(dp.unit),
    };
    if (states) {
        shape.states = states;
    }
    if (hasRange) {
        shape.min = dp.min as number;
        shape.max = dp.max as number;
    }
    if (dp.step !== null && dp.step > 0 && !states) {
        shape.step = dp.step;
    }
    if (dp.unit) {
        shape.unit = dp.unit;
    }
    if (writable && shape.role.startsWith('value.')) {
        // Writable temperatures/levels use the matching "level" role family.
        shape.role = shape.role.replace('value.', 'level.');
    }
    return shape;
}

/**
 * Value -> text map. Controller texts (AufzaehlTexte) are used whenever they exist, also for integer
 * datapoints without an explicit `enum` list (e.g. "Off / 0 to 10V / PWM"). Explicit enum codes without
 * a text keep their numeric label so the dropdown stays complete.
 *
 * @param dp Datapoint
 */
export function enumStates(dp: Datapoint): Record<string, string> | undefined {
    const texts = dp.enumTexts ?? {};
    let codes: number[];
    if (dp.enumValues) {
        codes = dp.enumValues;
    } else {
        codes = Object.keys(texts)
            .map(Number)
            .filter(
                v =>
                    Number.isInteger(v) &&
                    (dp.min === null || dp.max === null || dp.max <= dp.min || (v >= dp.min && v <= dp.max)),
            );
    }
    if (codes.length === 0) {
        return undefined;
    }
    return Object.fromEntries(codes.map(v => [String(v), texts[String(v)] ?? String(v)]));
}

/**
 * Convert the raw controller string to the state's value type. Returns null for missing or invalid values.
 *
 * @param raw Raw controller value
 * @param type State type
 */
export function coerceValue(raw: string | null, type: StateKind): number | string | null {
    if (raw === null) {
        return null;
    }
    if (type === 'string') {
        return raw;
    }
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
}
