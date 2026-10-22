import type { ControllerInfo, Datapoint, LonVariable } from '../models/Datapoint';

export interface ModuleListItem {
    nodeId: number;
    name: string;
    group: string;
    subnet: number;
    programId: string;
    neuronId: string;
}

export interface FunctionListItem {
    fctId: number;
    fctType: number;
    name: string;
    locked: boolean;
}

export interface LookupListItem {
    id: number;
    count: number;
}

export interface GroupReadResult {
    datapoints: Datapoint[];
    lon: LonVariable[];
    /** Number of items that could not be parsed. */
    skipped: number;
    /** A paging request failed; the result holds only the entries received before it. */
    incomplete?: boolean;
}

/**
 * Read-only view of a controller API family. Writes live on {@link WritableControllerApi} so that code
 * which only needs telemetry cannot accidentally gain write access.
 */
export interface ControllerApi {
    readonly family: string;
    getControllerInfo(): Promise<ControllerInfo>;
    listModules(): Promise<ModuleListItem[]>;
    listFunctions(nodeId: number): Promise<FunctionListItem[]>;
    listLookups(nodeId: number, fctId: number): Promise<LookupListItem[]>;
    /** Read all entries of one lookup group (the unit of polling). */
    readGroup(nodeId: number, fctId: number, lookupId: number, announcedCount: number): Promise<GroupReadResult>;
    /** Re-read a single datapoint by native OID (used for write read-back). */
    readDatapoint(oid: string): Promise<Datapoint | null>;
    /** Read a structured object (e.g. a time program) by native OID. Payload shape is firmware-specific. */
    readObject(oid: string): Promise<unknown>;
    /** Read a single LON variable value. */
    readLonValue(nodeId: number, fctId: number, lookupId: number, nvIndex: number): Promise<LonVariable | null>;
}

export interface WritableControllerApi extends ControllerApi {
    /** Send one value. The caller is responsible for validation and read-back. */
    writeDatapoint(oid: string, value: string): Promise<void>;
}
