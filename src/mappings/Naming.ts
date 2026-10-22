import type { TextTables } from '../api/ResourceTexts';
import { displayCode } from '../api/parsers';
import type { Catalog, Datapoint, FunctionInfo, ModuleInfo } from '../models/Datapoint';

/** API names that only encode numbers (e.g. "02-010", "Knoten 15", "Funktion 14-0") carry no meaning. */
const GENERIC_NAME = /^(\d{1,3}-\d{1,3}|(knoten|node|modul|module)\s*\d+|(funktion|function)\s*-?\d+(-\d+)?|)$/i;

export function isGenericName(name: string | null | undefined): boolean {
    return GENERIC_NAME.test((name ?? '').trim());
}

const varKey = (dp: Pick<Datapoint, 'groupNr' | 'memberNr'>): string => `${dp.groupNr}:${dp.memberNr}`;

/**
 * Combine the menu level ("Heating limits") and variable ("Max. flow temp.") names the way the controller's
 * own UI presents them: variable names alone are often ambiguous ("Set point", "Actual").
 *
 * @param level Menu level name
 * @param variable Variable name
 */
export function composeName(level: string | undefined, variable: string | undefined): string | undefined {
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

export function variableText(dp: Datapoint, texts: TextTables): string | undefined {
    const fromTable = texts.variables.get(varKey(dp));
    if (fromTable) {
        return fromTable;
    }
    return isGenericName(dp.name) ? undefined : dp.name;
}

export function enumTextsFor(dp: Datapoint, texts: TextTables): Record<string, string> | undefined {
    return texts.enums.get(varKey(dp));
}

export function levelText(fn: Pick<FunctionInfo, 'fctType'>, levelId: number, texts: TextTables): string | undefined {
    return texts.levels.get(`${fn.fctType}:${levelId}`);
}

export function functionLabel(fn: FunctionInfo): string | undefined {
    return isGenericName(fn.name) ? undefined : fn.name;
}

export function moduleLabel(module: ModuleInfo): string | undefined {
    if (!isGenericName(module.name)) {
        return module.name;
    }
    // A module with exactly one named function is best described by that function.
    const named = module.functions.map(f => f.label).filter((l): l is string => !!l);
    return named.length === 1 ? named[0] : undefined;
}

/**
 * Attach readable labels to a catalog in place. Identity is untouched: ids stay OID-based.
 *
 * @param catalog Discovered catalog
 * @param texts Controller text tables
 */
export function applyLabels(catalog: Catalog, texts: TextTables): void {
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
                            ? `${group.label} (${displayCode(dp)})`
                            : undefined
                        : group.label
                          ? composeName(group.label, variable)
                          : `${variable} (${displayCode(dp)})`;
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
