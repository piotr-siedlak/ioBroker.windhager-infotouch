import type { TextTables } from '../api/ResourceTexts';
import type { Catalog, Datapoint, FunctionInfo, LookupGroup, ModuleInfo } from '../models/Datapoint';

/** API names that only encode numbers (e.g. "02-010", "Knoten 15", "Funktion 14-0") carry no meaning. */
const GENERIC_NAME = /^(\d{1,3}-\d{1,3}|(knoten|node|modul|module)\s*\d+|(funktion|function)\s*-?\d+(-\d+)?|)$/i;

export function isGenericName(name: string | null | undefined): boolean {
    return GENERIC_NAME.test((name ?? '').trim());
}

const varKey = (dp: Pick<Datapoint, 'groupNr' | 'memberNr'>): string | null =>
    dp.groupNr !== null && dp.memberNr !== null && dp.groupNr >= 0 && dp.memberNr >= 0
        ? `${dp.groupNr}:${dp.memberNr}`
        : null;

export function datapointLabel(dp: Datapoint, texts: TextTables): string | undefined {
    const key = varKey(dp);
    const fromTable = key ? texts.variables.get(key) : undefined;
    if (fromTable) {
        return fromTable;
    }
    return isGenericName(dp.name) ? undefined : dp.name;
}

export function enumTextsFor(dp: Datapoint, texts: TextTables): Record<string, string> | undefined {
    const key = varKey(dp);
    return key ? texts.enums.get(key) : undefined;
}

export function groupLabel(group: LookupGroup, fn: FunctionInfo, texts: TextTables): string | undefined {
    return texts.levels.get(`${fn.fctType}:${group.lookupId}`);
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
