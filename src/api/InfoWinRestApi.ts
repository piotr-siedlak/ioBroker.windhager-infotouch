import type { ControllerInfo, LonVariable, Datapoint } from '../models/Datapoint';
import type {
    FunctionListItem,
    GroupReadResult,
    LookupListItem,
    ModuleListItem,
    WritableControllerApi,
} from './ControllerApi';
import { malformedError, validationError, WindhagerError } from './errors';
import type { HttpClient } from './HttpClient';
import { asInt, isRecord, parseDatapoint, parseLonVariable, parseOid } from './parsers';

const PAGE_SIZE = 10;

/** Identity of a raw lookup item for de-duplication across pages. */
function itemKey(item: unknown): string {
    if (isRecord(item)) {
        if (typeof item.OID === 'string') {
            return `oid:${item.OID}`;
        }
        if (item.nvIndex !== undefined) {
            return `nv:${JSON.stringify(item.nvIndex)}`;
        }
    }
    return `raw:${JSON.stringify(item)}`;
}
const MAX_PAGES = 50;

/**
 * "Lookup" API family (`/api/1.0/lookup/...`, `/api/1.0/datapoint`) as used by the InfoWIN Touch web interface
 * and documented by community projects. Behaviour is derived from public sources and recorded responses; see
 * RESEARCH.md for the evidence level of each call.
 */
export class InfoWinRestApi implements WritableControllerApi {
    public readonly family = 'infowin-rest-1.0';

    public constructor(private readonly http: HttpClient) {}

    private async lookupArray(path: string, query?: Record<string, string | number>): Promise<unknown[]> {
        const data = await this.http.getJson(`/api/1.0/lookup${path}`, query);
        if (Array.isArray(data)) {
            return data;
        }
        if (isRecord(data)) {
            return [data];
        }
        throw malformedError(`Unexpected lookup payload for ${path}`);
    }

    public async getControllerInfo(): Promise<ControllerInfo> {
        const data = await this.http.getJson('/api/1.0/info/deviceinfo');
        const item = Array.isArray(data) ? data.find(isRecord) : isRecord(data) ? data : undefined;
        if (!item) {
            throw malformedError('Unexpected deviceinfo payload');
        }
        return {
            device: typeof item.device === 'string' ? item.device : null,
            version: typeof item.version === 'string' ? item.version : null,
        };
    }

    public async listModules(): Promise<ModuleListItem[]> {
        const out: ModuleListItem[] = [];
        for (const item of await this.lookupArray('/1')) {
            const nodeId = isRecord(item) ? asInt(item.nodeId) : null;
            if (!isRecord(item) || nodeId === null) {
                continue;
            }
            out.push({
                nodeId,
                name: typeof item.name === 'string' ? item.name : `Node ${nodeId}`,
                group: typeof item.group === 'string' ? item.group : '',
                subnet: asInt(item.subnet) ?? 0,
                programId: typeof item.programId === 'string' ? item.programId : '',
                neuronId: typeof item.neuronId === 'string' ? item.neuronId : '',
            });
        }
        return out;
    }

    public async listFunctions(nodeId: number): Promise<FunctionListItem[]> {
        const data = await this.http.getJson(`/api/1.0/lookup/1/${nodeId}`);
        const functions = isRecord(data) ? data.functions : undefined;
        if (!Array.isArray(functions)) {
            throw malformedError(`Module ${nodeId}: missing "functions"`);
        }
        const out: FunctionListItem[] = [];
        for (const item of functions) {
            const fctId = isRecord(item) ? asInt(item.fctId) : null;
            if (!isRecord(item) || fctId === null) {
                continue;
            }
            out.push({
                fctId,
                fctType: asInt(item.fctType) ?? -1,
                name: typeof item.name === 'string' ? item.name : '',
                locked: item.lock === true,
            });
        }
        return out;
    }

    public async listLookups(nodeId: number, fctId: number): Promise<LookupListItem[]> {
        const out: LookupListItem[] = [];
        for (const item of await this.lookupArray(`/1/${nodeId}/${fctId}`)) {
            const id = isRecord(item) ? asInt(item.id) : null;
            if (!isRecord(item) || id === null) {
                continue;
            }
            out.push({ id, count: asInt(item.count) ?? 0 });
        }
        return out;
    }

    private parseItems(items: unknown[], nodeId: number, fctId: number, lookupId: number, into: GroupReadResult): void {
        for (const item of items) {
            const dp = parseDatapoint(item);
            if (dp) {
                into.datapoints.push(dp);
                continue;
            }
            const nv = parseLonVariable(item, nodeId, fctId, lookupId);
            if (nv) {
                into.lon.push(nv);
                continue;
            }
            // Entries without an OID (header rows, resolved only by member detail calls in other projects) are
            // counted but not interpreted: we do not guess addresses.
            into.skipped++;
        }
    }

    public async readGroup(
        nodeId: number,
        fctId: number,
        lookupId: number,
        announcedCount: number,
    ): Promise<GroupReadResult> {
        const base = `/1/${nodeId}/${fctId}/${lookupId}`;
        const result: GroupReadResult = { datapoints: [], lon: [], skipped: 0 };
        const first = await this.lookupArray(base);
        this.parseItems(first, nodeId, fctId, lookupId, result);

        // The controller returns up to ten entries per request. Page only when fewer than announced arrived.
        // Paging via ?count/&offset is only fixture-tested (see RESEARCH.md P7), so it is defensive:
        // - every item kind is deduplicated, in case the controller ignores the offset;
        // - a failing page keeps what was already read (connectivity errors still propagate).
        const seen = new Set(first.map(itemKey));
        let received = first.length;
        for (let page = 0; page < MAX_PAGES && received > 0 && received < announcedCount; page++) {
            let items: unknown[];
            try {
                items = await this.lookupArray(base, { count: PAGE_SIZE, offset: received });
            } catch (err) {
                if (
                    err instanceof WindhagerError &&
                    (err.kind === 'auth' || err.kind === 'connection' || err.kind === 'timeout')
                ) {
                    throw err;
                }
                result.incomplete = true;
                break;
            }
            const fresh = items.filter(i => !seen.has(itemKey(i)));
            if (fresh.length === 0) {
                break;
            }
            fresh.forEach(i => seen.add(itemKey(i)));
            this.parseItems(fresh, nodeId, fctId, lookupId, result);
            received += fresh.length;
        }
        return result;
    }

    public async readDatapoint(oid: string): Promise<Datapoint | null> {
        if (!parseOid(oid)) {
            throw validationError(`Invalid OID: ${oid}`);
        }
        for (const item of await this.lookupArray(oid)) {
            const dp = parseDatapoint(item);
            if (dp && dp.oid === oid) {
                return dp;
            }
        }
        return null;
    }

    public async readObject(oid: string): Promise<unknown> {
        if (!parseOid(oid)) {
            throw validationError(`Invalid OID: ${oid}`);
        }
        // Takes ONE query parameter holding the full OID (not split into node/function/oid).
        return this.http.getJson('/api/1.0/object', { OID: oid });
    }

    public async readLonValue(
        nodeId: number,
        fctId: number,
        lookupId: number,
        nvIndex: number,
    ): Promise<LonVariable | null> {
        const items = await this.lookupArray(`/1/${nodeId}/${fctId}/${lookupId}/${nvIndex}`, {
            count: PAGE_SIZE,
            offset: 0,
        });
        for (const item of items) {
            const nv = parseLonVariable(item, nodeId, fctId, lookupId);
            if (nv && nv.index === nvIndex) {
                return nv;
            }
        }
        return null;
    }

    public async writeDatapoint(oid: string, value: string): Promise<void> {
        if (!parseOid(oid)) {
            throw validationError(`Invalid OID: ${oid}`);
        }
        // The API expects every value as a string, even for numbers.
        await this.http.putJson('/api/1.0/datapoint', { OID: oid, value });
    }
}
