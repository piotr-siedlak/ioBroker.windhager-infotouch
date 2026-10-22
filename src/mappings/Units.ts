/**
 * Role heuristics based on the unit string reported by the controller. The original unit is always preserved
 * as-is; only the ioBroker role is inferred. Unknown units fall back to the generic `value` role.
 */
const UNIT_ROLES: Array<[RegExp, string]> = [
    [/^(°\s?C|degC|C)$/i, 'value.temperature'],
    [/^K$/, 'value.temperature'],
    [/^kW$/i, 'value.power'],
    [/^W$/i, 'value.power'],
    [/^kWh$/i, 'value.energy'],
    [/^bar$/i, 'value.pressure'],
    [/^(h|min|s)$/, 'value'],
];

export function roleForUnit(unit: string | null): string {
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
