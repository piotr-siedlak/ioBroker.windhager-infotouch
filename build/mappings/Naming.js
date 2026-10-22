"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isGenericName = isGenericName;
exports.datapointLabel = datapointLabel;
exports.enumTextsFor = enumTextsFor;
exports.groupLabel = groupLabel;
exports.functionLabel = functionLabel;
exports.moduleLabel = moduleLabel;
exports.applyLabels = applyLabels;
/** API names that only encode numbers (e.g. "02-010", "Knoten 15", "Funktion 14-0") carry no meaning. */
const GENERIC_NAME = /^(\d{1,3}-\d{1,3}|(knoten|node|modul|module)\s*\d+|(funktion|function)\s*-?\d+(-\d+)?|)$/i;
function isGenericName(name) {
    return GENERIC_NAME.test((name ?? '').trim());
}
const varKey = (dp) => dp.groupNr !== null && dp.memberNr !== null && dp.groupNr >= 0 && dp.memberNr >= 0
    ? `${dp.groupNr}:${dp.memberNr}`
    : null;
function datapointLabel(dp, texts) {
    const key = varKey(dp);
    const fromTable = key ? texts.variables.get(key) : undefined;
    if (fromTable) {
        return fromTable;
    }
    return isGenericName(dp.name) ? undefined : dp.name;
}
function enumTextsFor(dp, texts) {
    const key = varKey(dp);
    return key ? texts.enums.get(key) : undefined;
}
function groupLabel(group, fn, texts) {
    return texts.levels.get(`${fn.fctType}:${group.lookupId}`);
}
function functionLabel(fn) {
    return isGenericName(fn.name) ? undefined : fn.name;
}
function moduleLabel(module) {
    if (!isGenericName(module.name)) {
        return module.name;
    }
    // A module with exactly one named function is best described by that function.
    const named = module.functions.map(f => f.label).filter((l) => !!l);
    return named.length === 1 ? named[0] : undefined;
}
/**
 * Attach readable labels to a catalog in place. Identity is untouched: ids stay OID-based.
 *
 * @param catalog Discovered catalog
 * @param texts Controller text tables
 */
function applyLabels(catalog, texts) {
    for (const module of catalog.modules) {
        for (const fn of module.functions) {
            fn.label = functionLabel(fn);
            for (const group of fn.lookups) {
                group.label = groupLabel(group, fn, texts);
                for (const dp of group.datapoints) {
                    dp.label = datapointLabel(dp, texts);
                    const enumTexts = enumTextsFor(dp, texts);
                    if (enumTexts) {
                        dp.enumTexts = enumTexts;
                    }
                }
            }
        }
        module.label = moduleLabel(module);
    }
}
