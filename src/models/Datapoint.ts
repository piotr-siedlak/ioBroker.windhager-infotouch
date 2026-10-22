/** One readable (and possibly writable) controller value, addressed by its native OID. */
export interface Datapoint {
    /** Stable identifier derived from the native OID, e.g. `n15.f0.l3.m50.i0`. Never derived from display names. */
    key: string;
    /** Native OID exactly as reported by the controller, e.g. `/1/15/0/3/50/0`. */
    oid: string;
    nodeId: number;
    fctId: number;
    lookupId: number;
    memberId: number;
    instance: number;
    /** Native label. May be empty or duplicated; never use as identity. */
    name: string;
    /** Raw value string as sent by the controller (`null` when absent or a placeholder). */
    value: string | null;
    unit: string | null;
    unitId: number | null;
    typeId: number | null;
    subtypeId: number | null;
    min: number | null;
    max: number | null;
    step: number | null;
    enumValues: number[] | null;
    /** `true`/`false` as reported; `null` when the controller did not say (treated as not writable). */
    writeProtected: boolean | null;
    timestamp: string | null;
    /** Variable identifier (group/member) used by the controller's text tables; -1 or null when absent. */
    groupNr: number | null;
    memberNr: number | null;
    /** Readable name resolved from the controller's text tables (VarIdentTexte), if available. */
    label?: string;
    /** Enum value -> readable text resolved from the controller's text tables (AufzaehlTexte). */
    enumTexts?: Record<string, string>;
}

/** LON network variable. Read-only; the type stays raw/unknown unless explicitly mapped. */
export interface LonVariable {
    key: string;
    nodeId: number;
    fctId: number;
    lookupId: number;
    index: number;
    name: string;
    snvtName: string | null;
    snvtIndex: number | null;
    value: string | null;
    unit: string | null;
}

export interface LookupGroup {
    nodeId: number;
    fctId: number;
    lookupId: number;
    /** Number of entries announced by the controller. */
    count: number;
    /** Stable key `n15.f0.l3`. */
    key: string;
    datapoints: Datapoint[];
    lon: LonVariable[];
    /** Readable menu-level name (EbenenTexte), if available. */
    label?: string;
}

export interface FunctionInfo {
    fctId: number;
    fctType: number;
    name: string;
    locked: boolean;
    lookups: LookupGroup[];
    /** Readable function name, if it could be resolved. */
    label?: string;
}

export interface ModuleInfo {
    nodeId: number;
    name: string;
    group: string;
    subnet: number;
    programId: string;
    neuronId: string;
    functions: FunctionInfo[];
    /** Readable module name, if it could be resolved. */
    label?: string;
}

export interface ControllerInfo {
    device: string | null;
    version: string | null;
}

export interface Catalog {
    /** Bumped when the cached format changes so old caches are discarded. */
    schemaVersion: number;
    discoveredAt: number;
    controller: ControllerInfo;
    /** Hash over module identities; a change invalidates the cache. */
    signature: string;
    modules: ModuleInfo[];
    /** Skipped items (malformed payloads), kept for diagnostics. */
    skipped: number;
    /** Options the scan ran with; a cache made with different options is not reused. */
    scanOptions: ScanFingerprint;
}

export interface ScanFingerprint {
    excludedNodes: number[];
    includeLon: boolean;
    /** Language of the controller text tables used for names. */
    language: string;
}

export function scanFingerprint(options: {
    excludedNodes: ReadonlySet<number>;
    includeLon: boolean;
    language?: string;
}): ScanFingerprint {
    return {
        excludedNodes: [...options.excludedNodes].sort((a, b) => a - b),
        includeLon: options.includeLon,
        language: options.language ?? '',
    };
}

export const CATALOG_SCHEMA_VERSION = 3;

export function moduleSignature(modules: Array<Pick<ModuleInfo, 'nodeId' | 'programId' | 'neuronId'>>): string {
    return modules
        .map(m => `${m.nodeId}:${m.programId}:${m.neuronId}`)
        .sort()
        .join('|');
}
