"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TEXT_LANGUAGES = exports.EMPTY_TEXTS = void 0;
exports.parseXml = parseXml;
exports.parseLevelTexts = parseLevelTexts;
exports.parseVariableTexts = parseVariableTexts;
exports.parseEnumTexts = parseEnumTexts;
exports.decodeXml = decodeXml;
exports.languageChain = languageChain;
exports.loadTextTables = loadTextTables;
const errors_1 = require("./errors");
exports.EMPTY_TEXTS = { language: '', levels: new Map(), variables: new Map(), enums: new Map() };
/** Languages for which controllers are reported to ship text tables. Others fall back. */
exports.TEXT_LANGUAGES = ['de', 'en', 'fr', 'it', 'pl', 'nl', 'cs', 'sl', 'sk', 'es', 'hu'];
function decodeEntities(s) {
    return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_m, e) => {
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
function parseXml(xml) {
    const root = { name: '#root', attrs: {}, children: [], text: '' };
    const stack = [root];
    const re = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<(\/?)([A-Za-z_][\w.-]*)([^>]*?)(\/?)>|([^<]+)/g;
    let m;
    while ((m = re.exec(xml)) !== null) {
        const top = stack[stack.length - 1];
        if (m[1] !== undefined) {
            top.text += m[1];
        }
        else if (m[6] !== undefined) {
            top.text += decodeEntities(m[6]);
        }
        else if (m[3] !== undefined) {
            if (m[2] === '/') {
                const idx = stack.map(e => e.name).lastIndexOf(m[3]);
                if (idx > 0) {
                    stack.length = idx;
                }
                continue;
            }
            const attrs = {};
            for (const a of m[4].matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
                attrs[a[1]] = decodeEntities(a[2] ?? a[3] ?? '');
            }
            const el = { name: m[3], attrs, children: [], text: '' };
            top.children.push(el);
            if (m[5] !== '/') {
                stack.push(el);
            }
        }
    }
    return root;
}
function* descendants(el, name) {
    for (const child of el.children) {
        if (child.name === name) {
            yield child;
        }
        yield* descendants(child, name);
    }
}
const id = (el) => (/^-?\d+$/.test(el.attrs.id ?? '') ? String(Number(el.attrs.id)) : null);
const clean = (s) => s.replace(/\s+/g, ' ').trim();
function parseLevelTexts(xml) {
    const out = new Map();
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
function parseVariableTexts(xml) {
    const out = new Map();
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
function parseEnumTexts(xml) {
    const out = new Map();
    for (const gn of descendants(parseXml(xml), 'gn')) {
        const g = id(gn);
        for (const mn of gn.children.filter(c => c.name === 'mn')) {
            const n = id(mn);
            if (g === null || n === null) {
                continue;
            }
            const values = {};
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
function decodeXml(bytes) {
    const head = bytes.subarray(0, 200).toString('latin1');
    const declared = /encoding\s*=\s*["']([\w-]+)["']/i.exec(head)?.[1]?.toLowerCase() ?? 'utf-8';
    try {
        return new TextDecoder(declared).decode(bytes);
    }
    catch {
        return bytes.toString('utf8');
    }
}
/**
 * Language order: requested, then English, then German (always present on tested controllers).
 *
 * @param language Preferred language code
 */
function languageChain(language) {
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
async function loadTextTables(source, language, log) {
    const tables = { language: '', levels: new Map(), variables: new Map(), enums: new Map() };
    const files = [
        ['EbenenTexte', parseLevelTexts, tables.levels],
        ['VarIdentTexte', parseVariableTexts, tables.variables],
        ['AufzaehlTexte', parseEnumTexts, tables.enums],
    ];
    for (const [file, parse, target] of files) {
        for (const lang of languageChain(language)) {
            let parsed;
            try {
                parsed = parse(decodeXml(await source.getBytes(`/res/xml/${file}_${lang}.xml`)));
            }
            catch (err) {
                if (err instanceof errors_1.WindhagerError &&
                    (err.kind === 'auth' || err.kind === 'connection' || err.kind === 'timeout')) {
                    throw err;
                }
                log?.(`Text table ${file}_${lang} not available: ${err.message}`);
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
