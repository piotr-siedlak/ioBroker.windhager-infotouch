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
    const numericValue = dp.value !== null && Number.isFinite(Number(dp.value));
    const hasRange = dp.min !== null && dp.max !== null && dp.max > dp.min;
    const isNumber = dp.enumValues !== null || dp.unit !== null || hasRange || numericValue;

    if (!isNumber) {
        return { type: 'string', role: 'text' };
    }
    const shape: StateShape = {
        type: 'number',
        role: dp.enumValues ? (writable ? 'level' : 'value') : roleForUnit(dp.unit),
    };
    if (dp.enumValues) {
        // Controller text (AufzaehlTexte) when available, otherwise the raw code keeps the dropdown valid.
        shape.states = Object.fromEntries(dp.enumValues.map(v => [String(v), dp.enumTexts?.[String(v)] ?? String(v)]));
    } else {
        if (hasRange) {
            shape.min = dp.min as number;
            shape.max = dp.max as number;
        }
        if (dp.step !== null && dp.step > 0) {
            shape.step = dp.step;
        }
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
