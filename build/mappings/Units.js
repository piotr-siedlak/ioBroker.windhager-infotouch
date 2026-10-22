"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.roleForUnit = roleForUnit;
/**
 * Role heuristics based on the unit string reported by the controller. The original unit is always preserved
 * as-is; only the ioBroker role is inferred. Unknown units fall back to the generic `value` role.
 */
const UNIT_ROLES = [
    [/^(°\s?C|degC|C)$/i, 'value.temperature'],
    [/^K$/, 'value.temperature'],
    [/^kW$/i, 'value.power'],
    [/^W$/i, 'value.power'],
    [/^kWh$/i, 'value.energy'],
    [/^bar$/i, 'value.pressure'],
    [/^(h|min|s)$/, 'value'],
];
function roleForUnit(unit) {
    if (!unit) {
        return 'value';
    }
    for (const [re, role] of UNIT_ROLES) {
        if (re.test(unit.trim())) {
            return role;
        }
    }
    return 'value';
}
