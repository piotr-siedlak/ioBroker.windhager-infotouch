import type { Datapoint, LonVariable } from '../models/Datapoint';

/** OID layout observed in recorded responses: `/1/<node>/<function>/<lookup>/<member>/<instance>`. */
const OID_RE = /^\/1\/(\d+)\/(\d+)\/(\d+)\/(\d+)\/(\d+)$/;

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asInt(value: unknown): number | null {
    if (typeof value === 'number' && Number.isInteger(value)) {
        return value;
    }
    if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
        return Number(value);
    }
    return null;
}

export function asNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
        return Number(value);
    }
    return null;
}

function asString(value: unknown): string | null {
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
export function parseEnumField(raw: unknown): number[] | null {
    let parsed: unknown = raw;
    if (typeof raw === 'string') {
        if (raw.trim() === '') {
            return null;
        }
        try {
            parsed = JSON.parse(raw);
        } catch {
            return null;
        }
    }
    if (!Array.isArray(parsed)) {
        return null;
    }
    const values = parsed.map(asInt);
    return values.every((v): v is number => v !== null) && values.length > 0 ? values : null;
}

export function parseOid(
    oid: string,
): { nodeId: number; fctId: number; lookupId: number; memberId: number; instance: number } | null {
    const m = OID_RE.exec(oid);
    if (!m) {
        return null;
    }
    return {
        nodeId: Number(m[1]),
        fctId: Number(m[2]),
        lookupId: Number(m[3]),
        memberId: Number(m[4]),
        instance: Number(m[5]),
    };
}

export function datapointKey(p: {
    nodeId: number;
    fctId: number;
    lookupId: number;
    memberId: number;
    instance: number;
}): string {
    return `n${p.nodeId}.f${p.fctId}.l${p.lookupId}.m${p.memberId}.i${p.instance}`;
}

export function groupKey(nodeId: number, fctId: number, lookupId: number): string {
    return `n${nodeId}.f${fctId}.l${lookupId}`;
}

/** Placeholder values the controller uses for "no value". */
function cleanValue(raw: unknown): string | null {
    const s = asString(raw);
    if (s === null) {
        return null;
    }
    const trimmed = s.trim();
    return trimmed === '' || trimmed === '-' ? null : trimmed;
}

/**
 * Parse one datapoint entry. Returns null for items without a usable OID.
 *
 * @param item Raw JSON item from a lookup response
 */
export function parseDatapoint(item: unknown): Datapoint | null {
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
        unit: typeof item.unit === 'string' && item.unit !== '' ? item.unit : null,
        unitId: asInt(item.unitId),
        typeId: asInt(item.typeId),
        subtypeId: asInt(item.subtypeId),
        min: asNumber(item.minValue),
        max: asNumber(item.maxValue),
        step: asNumber(item.step),
        enumValues: parseEnumField(item.enum),
        writeProtected: typeof writeProt === 'boolean' ? writeProt : null,
        timestamp: typeof item.timestamp === 'string' ? item.timestamp : null,
        groupNr: asInt(item.groupNr),
        memberNr: asInt(item.memberNr),
    };
}

export function parseLonVariable(item: unknown, nodeId: number, fctId: number, lookupId: number): LonVariable | null {
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
