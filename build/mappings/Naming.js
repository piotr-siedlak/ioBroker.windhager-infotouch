"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isGenericName = isGenericName;
exports.composeName = composeName;
exports.variableText = variableText;
exports.enumTextsFor = enumTextsFor;
exports.levelText = levelText;
exports.functionLabel = functionLabel;
exports.moduleLabel = moduleLabel;
exports.applyLabels = applyLabels;
const parsers_1 = require("../api/parsers");
/** API names that only encode numbers (e.g. "02-010", "Knoten 15", "Funktion 14-0") carry no meaning. */
const GENERIC_NAME = /^(\d{1,3}-\d{1,3}|(knoten|node|modul|module)\s*\d+|(funktion|function)\s*-?\d+(-\d+)?|)$/i;
function isGenericName(name) {
    return GENERIC_NAME.test((name ?? '').trim());
}
const varKey = (dp) => `${dp.groupNr}:${dp.memberNr}`;
/**
 * Combine the menu level ("Heating limits") and variable ("Max. flow temp.") names the way the controller's
 * own UI presents them: variable names alone are often ambiguous ("Set point", "Actual").
 *
 * @param level Menu level name
 * @param variable Variable name
 */
function composeName(level, variable) {
    const l = level?.trim();
    const v = variable?.trim();
    if (!v) {
        return l || undefined;
    }
    if (!l || v.toLowerCase().includes(l.toLowerCase())) {
        return v;
    }
    return `${l}: ${v}`;
}
function variableText(dp, texts) {
    const fromTable = texts.variables.get(varKey(dp));
    if (fromTable) {
        return fromTable;
    }
    return isGenericName(dp.name) ? undefined : dp.name;
}
function enumTextsFor(dp, texts) {
    return texts.enums.get(varKey(dp));
}
function levelText(fn, levelId, texts) {
    return texts.levels.get(`${fn.fctType}:${levelId}`);
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
                group.label = levelText(fn, group.lookupId, texts);
                for (const dp of group.datapoints) {
                    dp.levelLabel = group.label;
                    const variable = variableText(dp, texts);
                    // Without a variable name the level alone is not unique: add the controller code.
                    // Without a menu level (cache-only values) or without a variable text, the code keeps names unique.
                    dp.label = !variable
                        ? group.label
                            ? `${group.label} (${(0, parsers_1.displayCode)(dp)})`
                            : undefined
                        : group.label
                            ? composeName(group.label, variable)
                            : `${variable} (${(0, parsers_1.displayCode)(dp)})`;
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
