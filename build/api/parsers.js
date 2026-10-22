"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isRecord = isRecord;
exports.asInt = asInt;
exports.asNumber = asNumber;
exports.parseEnumField = parseEnumField;
exports.parseOid = parseOid;
exports.datapointKey = datapointKey;
exports.displayCode = displayCode;
exports.groupKey = groupKey;
exports.parseDatapoint = parseDatapoint;
exports.parseLonVariable = parseLonVariable;
/** OID layout: `/<subnet>/<node>/<function>/<group>/<member>/<instance>` (Swagger RestApiRC7030 `datapoint`). */
const OID_RE = /^\/(\d+)\/(\d+)\/(\d+)\/(\d+)\/(\d+)\/(\d+)$/;
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function asInt(value) {
    if (typeof value === 'number' && Number.isInteger(value)) {
        return value;
    }
    if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
        return Number(value);
    }
    return null;
}
function asNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
        return Number(value);
    }
    return null;
}
function asString(value) {
    if (typeof value === 'string') {
        return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }
    return null;
}
/**
 * The controller sends the enum list as a JSON-encoded string (e.g. `"[0,1,2]"`). Tolerate real arrays too.
 *
 * @param raw Value of the `enum` field
 */
function parseEnumField(raw) {
    let parsed = raw;
    if (typeof raw === 'string') {
        if (raw.trim() === '') {
            return null;
        }
        try {
            parsed = JSON.parse(raw);
        }
        catch {
            return null;
        }
    }
    if (!Array.isArray(parsed)) {
        return null;
    }
    const values = parsed.map(asInt);
    return values.every((v) => v !== null) && values.length > 0 ? values : null;
}
function parseOid(oid) {
    const m = OID_RE.exec(oid);
    if (!m) {
        return null;
    }
    return {
        subnet: Number(m[1]),
        nodeId: Number(m[2]),
        fctId: Number(m[3]),
        groupNr: Number(m[4]),
        memberNr: Number(m[5]),
        instance: Number(m[6]),
    };
}
function datapointKey(p) {
    return `s${p.subnet}.n${p.nodeId}.f${p.fctId}.g${p.groupNr}.m${p.memberNr}.i${p.instance}`;
}
/** Controller display code, e.g. `03-051` (group 3, member 51). */
function displayCode(p) {
    return `${String(p.groupNr).padStart(2, '0')}-${String(p.memberNr).padStart(3, '0')}`;
}
function groupKey(nodeId, fctId, lookupId) {
    return `n${nodeId}.f${fctId}.l${lookupId}`;
}
/** Placeholder values the controller uses for "no value". */
function cleanValue(raw) {
    const s = asString(raw);
    if (s === null) {
        return null;
    }
    const trimmed = s.trim();
    return trimmed === '' || /^-+(\.-+)?$/.test(trimmed) ? null : trimmed; // '-', '--', '-.-' = no value
}
/**
 * Parse one datapoint entry. Returns null for items without a usable OID.
 *
 * @param item Raw JSON item from a lookup or datapoint response
 * @param levelId Menu level the item was listed in, if any
 */
function parseDatapoint(item, levelId = null) {
    if (!isRecord(item) || typeof item.OID !== 'string') {
        return null;
    }
    const parts = parseOid(item.OID);
    if (!parts) {
        return null;
    }
    const writeProt = item.writeProt === 'true' ? true : item.writeProt === 'false' ? false : item.writeProt;
    return {
        key: datapointKey(parts),
        oid: item.OID,
        ...parts,
        name: typeof item.name === 'string' ? item.name : '',
        value: cleanValue(item.value),
        // Some unit fields hold only the numeric unit id (e.g. "20" = date, "21" = time): not a real unit.
        unit: typeof item.unit === 'string' && item.unit.trim() !== '' && !/^\d+$/.test(item.unit.trim())
            ? item.unit.trim()
            : null,
        unitId: asInt(item.unitId),
        typeId: asInt(item.typeId),
        subtypeId: asInt(item.subtypeId),
        min: asNumber(item.minValue),
        max: asNumber(item.maxValue),
        step: asNumber(item.step),
        enumValues: parseEnumField(item.enum),
        writeProtected: typeof writeProt === 'boolean' ? writeProt : null,
        timestamp: typeof item.timestamp === 'string' ? item.timestamp : null,
        levelId,
    };
}
function parseLonVariable(item, nodeId, fctId, lookupId) {
    if (!isRecord(item) || typeof item.nvName !== 'string') {
        return null;
    }
    const index = asInt(item.nvIndex);
    if (index === null) {
        return null;
    }
    return {
        key: `n${nodeId}.f${fctId}.l${lookupId}.nv${index}`,
        nodeId,
        fctId,
        lookupId,
        index,
        name: item.nvName,
        snvtName: typeof item.snvtName === 'string' ? item.snvtName : null,
        snvtIndex: asInt(item.snvtIndex),
        value: cleanValue(item.value),
        unit: typeof item.unit === 'string' && item.unit !== '' ? item.unit : null,
    };
}
