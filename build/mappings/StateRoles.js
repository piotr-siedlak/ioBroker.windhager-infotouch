"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shapeFor = shapeFor;
exports.enumStates = enumStates;
exports.coerceValue = coerceValue;
const Units_1 = require("./Units");
/**
 * Decide the ioBroker type/role for a datapoint from its metadata. The decision depends only on discovery
 * metadata (and, as a last resort, the discovery-time value) so that it stays stable across polls.
 *
 * @param dp Datapoint
 * @param writable Whether the resulting state will accept user writes
 */
function shapeFor(dp, writable) {
    // Structured objects (typeId 30): text such as versions (subtype 9) or JSON such as time programs.
    if (dp.typeId === 30) {
        return { type: 'string', role: dp.subtypeId === 9 ? 'text' : 'json' };
    }
    const hasRange = dp.min !== null && dp.max !== null && dp.max > dp.min;
    // Dates/times (typeId 4, e.g. "22.10.2026", "14:54") are not numbers even though they have min/max strings.
    const numericValue = dp.value === null ? null : Number.isFinite(Number(dp.value));
    const isNumber = numericValue === true ||
        (numericValue === null &&
            (dp.enumValues !== null || dp.enumTexts !== undefined || dp.unit !== null || hasRange));
    if (!isNumber) {
        return { type: 'string', role: 'text' };
    }
    const states = enumStates(dp);
    const shape = {
        type: 'number',
        role: states ? (writable ? 'level' : 'value') : (0, Units_1.roleForUnit)(dp.unit),
    };
    if (states) {
        shape.states = states;
    }
    if (hasRange) {
        shape.min = dp.min;
        shape.max = dp.max;
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
function enumStates(dp) {
    const texts = dp.enumTexts ?? {};
    let codes;
    if (dp.enumValues) {
        codes = dp.enumValues;
    }
    else {
        codes = Object.keys(texts)
            .map(Number)
            .filter(v => Number.isInteger(v) &&
            (dp.min === null || dp.max === null || dp.max <= dp.min || (v >= dp.min && v <= dp.max)));
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
function coerceValue(raw, type) {
    if (raw === null) {
        return null;
    }
    if (type === 'string') {
        return raw;
    }
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
}
