import { WindhagerError } from './errors';

/**
 * Readable names shipped by the controller's own web interface under `/res/xml/` (see RESEARCH.md P16):
 *
 * - `EbenenTexte_<lang>.xml`   `<fcttyp id><ebene id>name</ebene></fcttyp>`   menu level (lookup group) names,
 *   unique only per function type
 * - `VarIdentTexte_<lang>.xml` `<gn id><mn id>name</mn></gn>`                 datapoint names by group/member number
 * - `AufzaehlTexte_<lang>.xml` `<gn id><mn id><enum id>text</enum></mn></gn>` enum value texts
 *
 * Missing files or entries are normal (they differ per firmware/language); callers fall back to API names.
 */
export interface TextTables {
    language: string;
    /** `${fctType}:${lookupId}` -> name */
    levels: Map<string, string>;
    /** `${groupNr}:${memberNr}` -> name */
    variables: Map<string, string>;
    /** `${groupNr}:${memberNr}` -> enum value -> text */
    enums: Map<string, Record<string, string>>;
}

export const EMPTY_TEXTS: TextTables = { language: '', levels: new Map(), variables: new Map(), enums: new Map() };

/** Languages for which controllers are reported to ship text tables. Others fall back. */
export const TEXT_LANGUAGES = ['de', 'en', 'fr', 'it', 'pl', 'nl', 'cs', 'sl', 'sk', 'es', 'hu'];

interface XmlElement {
    name: string;
    attrs: Record<string, string>;
    children: XmlElement[];
    text: string;
}

function decodeEntities(s: string): string {
    return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_m, e: string) => {
        const lower = e.toLowerCase();
        if (lower.startsWith('#x')) {
            return String.fromCodePoint(parseInt(lower.slice(2), 16));
        }
        if (lower.startsWith('#')) {
            return String.fromCodePoint(parseInt(lower.slice(1), 10));
        }
        return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[lower] ?? '';
    });
}

/**
 * Tolerant parser for the small, flat XML text tables. Not a general XML parser: no namespaces or DTDs.
 * Malformed input never throws; unbalanced tags are closed implicitly.
 *
 * @param xml Document text
 */
export function parseXml(xml: string): XmlElement {
    const root: XmlElement = { name: '#root', attrs: {}, children: [], text: '' };
    const stack: XmlElement[] = [root];
    const re =
        /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<(\/?)([A-Za-z_][\w.-]*)([^>]*?)(\/?)>|([^<]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) !== null) {
        const top = stack[stack.length - 1];
        if (m[1] !== undefined) {
            top.text += m[1];
        } else if (m[6] !== undefined) {
            top.text += decodeEntities(m[6]);
        } else if (m[3] !== undefined) {
            if (m[2] === '/') {
                const idx = stack.map(e => e.name).lastIndexOf(m[3]);
                if (idx > 0) {
                    stack.length = idx;
                }
                continue;
            }
            const attrs: Record<string, string> = {};
            for (const a of m[4].matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
                attrs[a[1]] = decodeEntities(a[2] ?? a[3] ?? '');
            }
            const el: XmlElement = { name: m[3], attrs, children: [], text: '' };
            top.children.push(el);
            if (m[5] !== '/') {
                stack.push(el);
            }
        }
    }
    return root;
}

function* descendants(el: XmlElement, name: string): Generator<XmlElement> {
    for (const child of el.children) {
        if (child.name === name) {
            yield child;
        }
        yield* descendants(child, name);
    }
}

const id = (el: XmlElement): string | null => (/^-?\d+$/.test(el.attrs.id ?? '') ? String(Number(el.attrs.id)) : null);
const clean = (s: string): string => s.replace(/\s+/g, ' ').trim();

export function parseLevelTexts(xml: string): Map<string, string> {
    const out = new Map<string, string>();
    for (const fct of descendants(parseXml(xml), 'fcttyp')) {
        const f = id(fct);
        for (const level of fct.children.filter(c => c.name === 'ebene')) {
            const l = id(level);
            const text = clean(level.text);
            if (f !== null && l !== null && text) {
                out.set(`${f}:${l}`, text);
            }
        }
    }
    return out;
}

export function parseVariableTexts(xml: string): Map<string, string> {
    const out = new Map<string, string>();
    for (const gn of descendants(parseXml(xml), 'gn')) {
        const g = id(gn);
        for (const mn of gn.children.filter(c => c.name === 'mn')) {
            const n = id(mn);
            const text = clean(mn.text);
            if (g !== null && n !== null && text) {
                out.set(`${g}:${n}`, text);
            }
        }
    }
    return out;
}

export function parseEnumTexts(xml: string): Map<string, Record<string, string>> {
    const out = new Map<string, Record<string, string>>();
    for (const gn of descendants(parseXml(xml), 'gn')) {
        const g = id(gn);
        for (const mn of gn.children.filter(c => c.name === 'mn')) {
            const n = id(mn);
            if (g === null || n === null) {
                continue;
            }
            const values: Record<string, string> = {};
            for (const e of mn.children.filter(c => c.name === 'enum')) {
                const v = id(e);
                const text = clean(e.text);
                if (v !== null && text) {
                    values[v] = text;
                }
            }
            if (Object.keys(values).length > 0) {
                out.set(`${g}:${n}`, values);
            }
        }
    }
    return out;
}

/**
 * Decode using the charset declared in the XML prolog (controllers may serve ISO-8859-1).
 *
 * @param bytes Raw document
 */
export function decodeXml(bytes: Buffer): string {
    const head = bytes.subarray(0, 200).toString('latin1');
    const declared = /encoding\s*=\s*["']([\w-]+)["']/i.exec(head)?.[1]?.toLowerCase() ?? 'utf-8';
    try {
        return new TextDecoder(declared).decode(bytes);
    } catch {
        return bytes.toString('utf8');
    }
}

export interface ResourceSource {
    getBytes(path: string): Promise<Buffer>;
}

/**
 * Language order: requested, then English, then German (always present on tested controllers).
 *
 * @param language Preferred language code
 */
export function languageChain(language: string): string[] {
    const lang = language.toLowerCase().slice(0, 2);
    return [...new Set([lang, 'en', 'de'].filter(l => /^[a-z]{2}$/.test(l)))];
}

/**
 * Load all text tables. Read-only GETs. Each table falls back independently through the language chain
 * (requested -> en -> de); the first language that serves a non-empty table is used.
 * Connectivity/auth errors propagate; a missing file is not an error.
 *
 * @param source HTTP source
 * @param language Preferred language code
 * @param log Optional debug logger
 */
export async function loadTextTables(
    source: ResourceSource,
    language: string,
    log?: (m: string) => void,
): Promise<TextTables> {
    const tables: TextTables = { language: '', levels: new Map(), variables: new Map(), enums: new Map() };
    const files: Array<[string, (xml: string) => Map<string, unknown>, Map<string, unknown>]> = [
        ['EbenenTexte', parseLevelTexts, tables.levels],
        ['VarIdentTexte', parseVariableTexts, tables.variables],
        ['AufzaehlTexte', parseEnumTexts, tables.enums],
    ];
    for (const [file, parse, target] of files) {
        for (const lang of languageChain(language)) {
            let parsed: Map<string, unknown>;
            try {
                parsed = parse(decodeXml(await source.getBytes(`/res/xml/${file}_${lang}.xml`)));
            } catch (err) {
                if (
                    err instanceof WindhagerError &&
                    (err.kind === 'auth' || err.kind === 'connection' || err.kind === 'timeout')
                ) {
                    throw err;
                }
                log?.(`Text table ${file}_${lang} not available: ${(err as Error).message}`);
                continue;
            }
            if (parsed.size === 0) {
                continue;
            }
            tables.language ||= lang;
            for (const [k, v] of parsed) {
                target.set(k, v);
            }
            break; // first language that has this table wins; avoids downloading every translation
        }
    }
    return tables;
}
