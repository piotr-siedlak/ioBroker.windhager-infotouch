"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InfoWinRestApi = void 0;
const errors_1 = require("./errors");
const parsers_1 = require("./parsers");
const PAGE_SIZE = 10;
/** Identity of a raw lookup item for de-duplication across pages. */
function itemKey(item) {
    if ((0, parsers_1.isRecord)(item)) {
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
class InfoWinRestApi {
    http;
    family = 'infowin-rest-1.0';
    constructor(http) {
        this.http = http;
    }
    async lookupArray(path, query) {
        const data = await this.http.getJson(`/api/1.0/lookup${path}`, query);
        if (Array.isArray(data)) {
            return data;
        }
        if ((0, parsers_1.isRecord)(data)) {
            return [data];
        }
        throw (0, errors_1.malformedError)(`Unexpected lookup payload for ${path}`);
    }
    async getControllerInfo() {
        const data = await this.http.getJson('/api/1.0/info/deviceinfo');
        const item = Array.isArray(data) ? data.find(parsers_1.isRecord) : (0, parsers_1.isRecord)(data) ? data : undefined;
        if (!item) {
            throw (0, errors_1.malformedError)('Unexpected deviceinfo payload');
        }
        return {
            device: typeof item.device === 'string' ? item.device : null,
            version: typeof item.version === 'string' ? item.version : null,
        };
    }
    async listModules() {
        const out = [];
        for (const item of await this.lookupArray('/1')) {
            const nodeId = (0, parsers_1.isRecord)(item) ? (0, parsers_1.asInt)(item.nodeId) : null;
            if (!(0, parsers_1.isRecord)(item) || nodeId === null) {
                continue;
            }
            out.push({
                nodeId,
                name: typeof item.name === 'string' ? item.name : `Node ${nodeId}`,
                group: typeof item.group === 'string' ? item.group : '',
                subnet: (0, parsers_1.asInt)(item.subnet) ?? 0,
                programId: typeof item.programId === 'string' ? item.programId : '',
                neuronId: typeof item.neuronId === 'string' ? item.neuronId : '',
            });
        }
        return out;
    }
    async listFunctions(nodeId) {
        const data = await this.http.getJson(`/api/1.0/lookup/1/${nodeId}`);
        const functions = (0, parsers_1.isRecord)(data) ? data.functions : undefined;
        if (!Array.isArray(functions)) {
            throw (0, errors_1.malformedError)(`Module ${nodeId}: missing "functions"`);
        }
        const out = [];
        for (const item of functions) {
            const fctId = (0, parsers_1.isRecord)(item) ? (0, parsers_1.asInt)(item.fctId) : null;
            if (!(0, parsers_1.isRecord)(item) || fctId === null) {
                continue;
            }
            out.push({
                fctId,
                fctType: (0, parsers_1.asInt)(item.fctType) ?? -1,
                name: typeof item.name === 'string' ? item.name : '',
                locked: item.lock === true,
            });
        }
        return out;
    }
    async listLookups(nodeId, fctId) {
        const out = [];
        for (const item of await this.lookupArray(`/1/${nodeId}/${fctId}`)) {
            const id = (0, parsers_1.isRecord)(item) ? (0, parsers_1.asInt)(item.id) : null;
            if (!(0, parsers_1.isRecord)(item) || id === null) {
                continue;
            }
            out.push({ id, count: (0, parsers_1.asInt)(item.count) ?? 0 });
        }
        return out;
    }
    parseItems(items, nodeId, fctId, lookupId, into) {
        for (const item of items) {
            const dp = (0, parsers_1.parseDatapoint)(item, lookupId);
            if (dp) {
                into.datapoints.push(dp);
                continue;
            }
            const nv = (0, parsers_1.parseLonVariable)(item, nodeId, fctId, lookupId);
            if (nv) {
                into.lon.push(nv);
                continue;
            }
            // Entries without an OID (header rows, resolved only by member detail calls in other projects) are
            // counted but not interpreted: we do not guess addresses.
            into.skipped++;
        }
    }
    async readGroup(nodeId, fctId, lookupId, announcedCount) {
        const base = `/1/${nodeId}/${fctId}/${lookupId}`;
        const result = { datapoints: [], lon: [], skipped: 0 };
        const first = await this.lookupArray(base);
        this.parseItems(first, nodeId, fctId, lookupId, result);
        // The controller returns up to ten entries per request. Page only when fewer than announced arrived.
        // Paging via ?count/&offset is only fixture-tested (see RESEARCH.md P7), so it is defensive:
        // - every item kind is deduplicated, in case the controller ignores the offset;
        // - a failing page keeps what was already read (connectivity errors still propagate).
        const seen = new Set(first.map(itemKey));
        let received = first.length;
        for (let page = 0; page < MAX_PAGES && received > 0 && received < announcedCount; page++) {
            let items;
            try {
                items = await this.lookupArray(base, { count: PAGE_SIZE, offset: received });
            }
            catch (err) {
                if (err instanceof errors_1.WindhagerError &&
                    (err.kind === 'auth' || err.kind === 'connection' || err.kind === 'timeout')) {
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
    async readDatapoint(oid) {
        if (!(0, parsers_1.parseOid)(oid)) {
            throw (0, errors_1.validationError)(`Invalid OID: ${oid}`);
        }
        // Swagger RestApiRC7030: GET /datapoint/{subnetId}/{nodeId}/{fctId}/{groupId}/{memberId}/{varInst}.
        // (Not /lookup<OID>: the lookup tree is addressed by menu level, which is not part of the OID.)
        const data = await this.http.getJson(`/api/1.0/datapoint${oid}`);
        const items = Array.isArray(data) ? data : [data];
        for (const item of items) {
            const dp = (0, parsers_1.parseDatapoint)(item);
            if (dp && dp.oid === oid) {
                return dp;
            }
        }
        return null;
    }
    async readCachedDatapoints() {
        const data = await this.http.getJson('/api/1.0/datapoints');
        if (!Array.isArray(data)) {
            throw (0, errors_1.malformedError)('Unexpected datapoints payload');
        }
        return data.map(item => (0, parsers_1.parseDatapoint)(item)).filter((dp) => dp !== null);
    }
    async readObject(oid) {
        if (!(0, parsers_1.parseOid)(oid)) {
            throw (0, errors_1.validationError)(`Invalid OID: ${oid}`);
        }
        // Takes ONE query parameter holding the full OID (not split into node/function/oid).
        return this.http.getJson('/api/1.0/object', { OID: oid });
    }
    async readLonValue(nodeId, fctId, lookupId, nvIndex) {
        const items = await this.lookupArray(`/1/${nodeId}/${fctId}/${lookupId}/${nvIndex}`, {
            count: PAGE_SIZE,
            offset: 0,
        });
        for (const item of items) {
            const nv = (0, parsers_1.parseLonVariable)(item, nodeId, fctId, lookupId);
            if (nv && nv.index === nvIndex) {
                return nv;
            }
        }
        return null;
    }
    async writeDatapoint(oid, value) {
        if (!(0, parsers_1.parseOid)(oid)) {
            throw (0, errors_1.validationError)(`Invalid OID: ${oid}`);
        }
        // The API expects every value as a string, even for numbers.
        await this.http.putJson('/api/1.0/datapoint', { OID: oid, value });
    }
}
exports.InfoWinRestApi = InfoWinRestApi;
