"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const utils = __importStar(require("@iobroker/adapter-core"));
const errors_1 = require("./api/errors");
const HttpClient_1 = require("./api/HttpClient");
const ProtocolDetector_1 = require("./api/ProtocolDetector");
const CapabilityRegistry_1 = require("./discovery/CapabilityRegistry");
const SystemScanner_1 = require("./discovery/SystemScanner");
const Datapoint_1 = require("./models/Datapoint");
const CommandService_1 = require("./services/CommandService");
const DiagnosticsService_1 = require("./services/DiagnosticsService");
const PollingService_1 = require("./services/PollingService");
const ObjectService_1 = require("./services/ObjectService");
const StateRegistry_1 = require("./services/StateRegistry");
const ResourceTexts_1 = require("./api/ResourceTexts");
const Naming_1 = require("./mappings/Naming");
const Sanitization_1 = require("./utils/Sanitization");
const Validation_1 = require("./utils/Validation");
const CACHE_OBJECT = 'cache';
const CACHE_FILE = 'catalog.json';
const RECONNECT_MIN_MS = 30_000;
const RECONNECT_MAX_MS = 10 * 60_000;
class WindhagerAdapter extends utils.Adapter {
    cfg;
    http = null;
    api = null;
    catalog = null;
    index = null;
    registry = null;
    polling = null;
    commands = null;
    diagnostics = new DiagnosticsService_1.DiagnosticsService();
    controllerOnline = false;
    reconnectTimer = null;
    diagTimer = null;
    reconnectDelay = RECONNECT_MIN_MS;
    unloading = false;
    busy = false;
    constructor(options = {}) {
        super({ ...options, name: 'windhager-infotouch' });
        this.on('ready', () => void this.onReady());
        this.on('stateChange', (id, state) => void this.onStateChange(id, state));
        this.on('message', obj => void this.onMessage(obj));
        this.on('unload', callback => this.onUnload(callback));
    }
    get secrets() {
        return [this.cfg?.password ?? ''];
    }
    logSafe(level, message) {
        this.log[level]((0, Sanitization_1.scrub)(message, this.secrets));
    }
    async onReady() {
        await this.setConnected(false);
        const { config, problems } = (0, Validation_1.normalizeConfig)(this.config);
        this.cfg = config;
        this.textLanguage = config.language || (await this.systemLanguage());
        for (const problem of problems) {
            this.logSafe('warn', problem);
        }
        if (!config.host) {
            this.logSafe('error', 'No host configured - open the instance settings');
            return;
        }
        if (!config.password) {
            this.logSafe('warn', 'No password configured; the controller will most likely reject the request');
        }
        this.logSafe('info', config.writesEnabled
            ? `Write mode ENABLED for ${config.writeAllowlist.size} allow-listed datapoint(s)`
            : 'Read-only mode (default)');
        await this.extendObject(CACHE_OBJECT, {
            type: 'meta',
            common: { name: 'Cache', type: 'meta.user' },
            native: {},
        });
        this.diagTimer = setInterval(() => void this.publishDiagnostics(), 30_000);
        await this.subscribeStatesAsync('diagnostics.rescan');
        await this.connect();
    }
    textLanguage = 'en';
    async systemLanguage() {
        try {
            const sys = await this.getForeignObjectAsync('system.config');
            const lang = sys?.common?.language;
            return typeof lang === 'string' && /^[a-z]{2}/.test(lang) ? lang.slice(0, 2) : 'en';
        }
        catch {
            return 'en';
        }
    }
    async setConnected(value) {
        this.controllerOnline = value;
        await this.setStateChangedAsync('info.connection', { val: value, ack: true });
    }
    buildHttp(config) {
        const http = new HttpClient_1.HttpClient({
            host: config.host,
            port: config.port,
            protocol: config.protocol,
            username: config.username,
            password: config.password,
            timeoutMs: config.timeoutMs,
            maxConcurrency: config.maxConcurrency,
            retries: 2,
            backoffBaseMs: 500,
            backoffMaxMs: 8000,
            verifyTls: config.verifyTls,
        });
        http.onMetric = metric => this.diagnostics.record(metric);
        return http;
    }
    /** Detect protocol, discover (or load cache), publish objects and start polling. Retries with backoff. */
    async connect() {
        if (this.unloading || this.busy) {
            return;
        }
        this.busy = true;
        try {
            this.http?.close();
            this.http = this.buildHttp(this.cfg);
            const detection = await (0, ProtocolDetector_1.detectProtocol)(this.http);
            if (detection.status !== 'ok' || !detection.api) {
                await this.handleDetectionFailure(detection);
                return;
            }
            this.api = detection.api;
            await this.setStateAsync('info.protocolVersion', { val: detection.family, ack: true });
            await this.setStateAsync('info.controllerModel', { val: detection.controller?.device ?? '', ack: true });
            await this.setStateAsync('info.firmwareVersion', { val: detection.controller?.version ?? '', ack: true });
            this.catalog = await this.loadOrScan(detection);
            await this.startServices();
            this.reconnectDelay = RECONNECT_MIN_MS;
        }
        catch (err) {
            await this.handleRuntimeError(err);
        }
        finally {
            this.busy = false;
        }
    }
    async handleDetectionFailure(detection) {
        const text = `${detection.status}: ${detection.message}`;
        await this.setStateAsync('info.lastError', { val: text, ack: true });
        this.diagnostics.note(`Detection failed - ${text}`);
        if (detection.status === 'auth') {
            // Do not retry automatically: repeated wrong credentials could lock the account.
            this.logSafe('error', 'Authentication failed. Check user name and password, then restart the instance.');
            return;
        }
        if (detection.status === 'unsupported' || detection.status === 'malformed') {
            this.logSafe('error', `The device does not look like a supported InfoWIN REST API (${detection.message}).`);
        }
        else {
            this.logSafe('warn', `Controller not reachable (${detection.message}); retrying in ${Math.round(this.reconnectDelay / 1000)} s`);
        }
        this.scheduleReconnect();
    }
    async handleRuntimeError(err) {
        const message = err instanceof Error ? err.message : String(err);
        await this.setStateAsync('info.lastError', { val: message, ack: true });
        if (err instanceof errors_1.WindhagerError && err.kind === 'auth') {
            this.logSafe('error', 'Authentication failed. Check user name and password, then restart the instance.');
            return;
        }
        this.logSafe('warn', `Connect failed: ${message}`);
        this.scheduleReconnect();
    }
    scheduleReconnect() {
        if (this.unloading) {
            return;
        }
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
        }
        this.reconnectTimer = setTimeout(() => void this.connect(), this.reconnectDelay);
        this.reconnectDelay = Math.min(RECONNECT_MAX_MS, this.reconnectDelay * 2);
    }
    async readCache() {
        try {
            const file = await this.readFileAsync(`${this.namespace}.${CACHE_OBJECT}`, CACHE_FILE);
            const parsed = JSON.parse(String(file.file));
            return parsed?.schemaVersion === Datapoint_1.CATALOG_SCHEMA_VERSION ? parsed : null;
        }
        catch {
            return null;
        }
    }
    async loadOrScan(detection) {
        const api = this.api;
        const cached = await this.readCache();
        if (cached) {
            const modules = await api.listModules();
            const maxAge = this.cfg.cacheMaxAgeHours * 3_600_000;
            const current = {
                modules,
                version: detection.controller?.version ?? null,
                scanOptions: (0, Datapoint_1.scanFingerprint)({
                    excludedNodes: this.cfg.excludedNodes,
                    includeLon: this.cfg.pollLon,
                    language: this.textLanguage,
                }),
            };
            if ((0, CapabilityRegistry_1.isCacheValid)(cached, current, maxAge)) {
                this.logSafe('info', 'Using cached discovery (module list, firmware and discovery options unchanged)');
                return cached;
            }
            this.logSafe('info', 'Cached discovery is outdated - rescanning');
        }
        return this.scan();
    }
    async scan() {
        const api = this.api;
        this.logSafe('info', 'Discovering controller structure (read-only)...');
        const catalog = await (0, SystemScanner_1.scanSystem)(api, {
            excludedNodes: this.cfg.excludedNodes,
            includeLon: this.cfg.pollLon,
            language: this.textLanguage,
            log: m => this.logSafe('debug', m),
        });
        // Readable names come from the controller's own text tables (read-only GETs); missing tables are fine.
        const texts = await (0, ResourceTexts_1.loadTextTables)(this.http, this.textLanguage, m => this.logSafe('debug', m));
        (0, Naming_1.applyLabels)(catalog, texts);
        this.logSafe('info', texts.variables.size > 0
            ? `Names loaded from controller (${texts.language}): ${texts.variables.size} datapoint, ${texts.levels.size} menu, ${texts.enums.size} enum texts`
            : 'Controller text tables not available - using generic names');
        try {
            await this.writeFileAsync(`${this.namespace}.${CACHE_OBJECT}`, CACHE_FILE, JSON.stringify(catalog));
        }
        catch (err) {
            this.logSafe('warn', `Could not store discovery cache: ${err.message}`);
        }
        const s = (0, CapabilityRegistry_1.summarize)(catalog);
        this.diagnostics.note(`Scan: ${s.modules} modules, ${s.datapoints} datapoints, ${catalog.skipped} skipped`);
        return catalog;
    }
    createPort() {
        return {
            extendObject: async (id, obj) => {
                await this.extendObject(id, obj);
            },
            setStateChanged: async (id, state) => {
                await this.setStateChangedAsync(id, state);
            },
            listObjects: async (prefix) => {
                const start = `${this.namespace}.${prefix}`;
                const view = await this.getObjectViewAsync('system', 'state', {
                    startkey: start,
                    endkey: `${start}\u9999`,
                });
                return (view.rows ?? []).map(row => ({
                    id: row.id.slice(this.namespace.length + 1),
                    type: 'state',
                    native: (row.value?.native ?? {}),
                }));
            },
        };
    }
    async startServices() {
        const api = this.api;
        const catalog = this.catalog;
        this.polling?.stop();
        this.index = (0, CapabilityRegistry_1.indexCatalog)(catalog);
        this.registry = new StateRegistry_1.StateRegistry(this.createPort(), {
            writesEnabled: this.cfg.writesEnabled,
            writeAllowlist: this.cfg.writeAllowlist,
            exposeRaw: this.cfg.exposeRaw,
            includeLon: this.cfg.pollLon,
        });
        const sync = await this.registry.sync(catalog);
        this.logSafe('info', `Objects ready: ${sync.datapoints} datapoints, ${sync.stale} newly stale, ${sync.revived} revived`);
        const index = this.index;
        this.commands = new CommandService_1.CommandService(api, {
            enabled: this.cfg.writesEnabled,
            allowlist: this.cfg.writeAllowlist,
            verify: this.cfg.verifyWrites,
            isConnected: () => this.controllerOnline,
            findDatapoint: oid => index.byOid.get(oid),
            audit: e => this.logSafe('info', `AUDIT write ${e.oid} "${e.name}" requested=${String(e.requested)} -> ${e.outcome}`),
        });
        for (const oid of this.cfg.writeAllowlist) {
            const id = this.registry.writableStateFor(oid);
            if (id) {
                await this.subscribeStatesAsync(id);
            }
            else {
                this.logSafe('warn', `Allow-listed OID ${oid} is not a writable datapoint on this controller - ignored`);
            }
        }
        const targets = [...index.groups.values()].map(group => ({
            group,
            category: group.datapoints.length === 0 && group.lon.length > 0 ? 'slow' : (0, CapabilityRegistry_1.categorize)(group, this.cfg.fastGroups),
        }));
        this.polling = new PollingService_1.PollingService(api, {
            onGroup: async (_group, result) => {
                await this.registry?.applyValues(result.datapoints);
            },
            onLon: async (_group, variables) => {
                await this.registry?.applyLonValues(variables);
            },
            onOnline: () => {
                void this.setConnected(true);
                this.diagnostics.note('Online');
                this.reconnectDelay = RECONNECT_MIN_MS;
            },
            onOffline: err => {
                this.logSafe('warn', `Controller offline: ${err.message}`);
                this.diagnostics.note(`Offline - ${err.message}`);
                void this.setConnected(false);
                void this.registry?.markAllStale();
                void this.setStateAsync('info.lastError', { val: (0, Sanitization_1.scrub)(err.message, this.secrets), ack: true });
            },
            onAuthFailure: err => {
                this.logSafe('error', `Authentication failed while polling (${err.message}); polling stopped to avoid account lock-out`);
                void this.setConnected(false);
                void this.setStateAsync('info.lastError', { val: err.message, ack: true });
            },
            onGroupError: (group, err) => {
                this.logSafe('debug', `Group ${group.key} skipped this cycle: ${err.message}`);
            },
            onCycle: (_category, _ms, ok) => {
                if (ok) {
                    void this.setStateAsync('info.lastSuccessfulPoll', {
                        val: new Date().toISOString(),
                        ack: true,
                    });
                    void this.maybePollSchedules();
                }
            },
        }, {
            intervals: {
                fast: this.cfg.enableFast ? this.cfg.pollFastSec : 0,
                normal: this.cfg.enableNormal ? this.cfg.pollNormalSec : 0,
                slow: this.cfg.enableSlow ? this.cfg.pollSlowSec : 0,
            },
            includeLon: this.cfg.pollLon,
        });
        this.polling.setTargets(targets);
        this.polling.start();
        await this.publishDiagnostics();
    }
    lastScheduleRead = 0;
    /** Structured objects (versions, time programs) are read at most every 15 min, read-only. */
    async maybePollSchedules() {
        if (!this.api || !this.catalog || !this.registry || Date.now() - this.lastScheduleRead < 15 * 60_000) {
            return;
        }
        this.lastScheduleRead = Date.now();
        for (const o of await (0, ObjectService_1.readObjects)(this.api, this.catalog)) {
            await this.registry.applyObjectValue(o.oid, o.value);
        }
    }
    async publishDiagnostics() {
        const d = this.diagnostics.snapshot();
        await this.setStateChangedAsync('diagnostics.requests', { val: d.requests, ack: true });
        await this.setStateChangedAsync('diagnostics.failures', { val: d.failures, ack: true });
        await this.setStateChangedAsync('diagnostics.lastLatencyMs', { val: d.lastLatencyMs, ack: true });
        await this.setStateChangedAsync('diagnostics.avgLatencyMs', { val: d.avgLatencyMs, ack: true });
        await this.setStateChangedAsync('diagnostics.consecutiveFailures', { val: d.consecutiveFailures, ack: true });
        if (this.catalog) {
            await this.setStateChangedAsync('diagnostics.datapoints', {
                val: (0, CapabilityRegistry_1.summarize)(this.catalog).datapoints,
                ack: true,
            });
            await this.setStateChangedAsync('diagnostics.catalogAgeHours', {
                val: Math.round((Date.now() - this.catalog.discoveredAt) / 3_600_000),
                ack: true,
            });
        }
    }
    async rescan() {
        if (!this.api || this.busy) {
            throw new Error('Not connected or busy');
        }
        this.busy = true;
        try {
            this.polling?.stop();
            try {
                this.catalog = await this.scan();
            }
            catch (err) {
                // Keep serving the previous catalog: a failed rescan must not silently stop polling.
                if (this.catalog) {
                    await this.startServices();
                }
                throw err;
            }
            await this.startServices();
        }
        finally {
            this.busy = false;
        }
    }
    async onStateChange(id, state) {
        if (!state || state.ack) {
            return;
        }
        const rel = id.slice(this.namespace.length + 1);
        if (rel === 'diagnostics.rescan') {
            if (state.val === true) {
                try {
                    await this.rescan();
                }
                catch (err) {
                    this.logSafe('warn', `Rescan failed: ${err.message}`);
                }
                await this.setStateAsync('diagnostics.rescan', { val: false, ack: true });
            }
            return;
        }
        const oid = this.registry?.oidForState(rel);
        if (!oid || !this.commands) {
            this.logSafe('warn', `Ignoring write to ${rel}: not a writable datapoint`);
            return;
        }
        const requested = typeof state.val === 'string' && state.val.trim() !== '' ? Number(state.val) : state.val;
        const outcome = await this.commands.write(oid, requested);
        if (outcome.ok) {
            await this.setStateAsync(rel, { val: outcome.value, ack: true, q: 0 });
            return;
        }
        this.logSafe('warn', `Write to ${rel} refused: ${outcome.code} - ${outcome.message}`);
        await this.restoreFromDevice(oid, rel, outcome.deviceValue);
    }
    /** After a refused/failed write, put the state back to what the controller actually has. */
    async restoreFromDevice(oid, rel, deviceValue) {
        if (typeof deviceValue === 'number') {
            await this.setStateAsync(rel, { val: deviceValue, ack: true });
            return;
        }
        const dp = this.index?.byOid.get(oid);
        if (!dp || !this.api) {
            return;
        }
        try {
            const fresh = await this.api.readDatapoint(oid);
            if (fresh) {
                await this.registry?.applyValues([fresh]);
            }
        }
        catch {
            // Offline: polling will resynchronise once the controller is back.
        }
    }
    async onMessage(obj) {
        if (!obj?.command || !obj.callback) {
            return;
        }
        const reply = (result) => {
            this.sendTo(obj.from, obj.command, result, obj.callback);
        };
        try {
            switch (obj.command) {
                case 'testConnection': {
                    // The admin form sends unsaved connection fields but never the password (it would travel in
                    // clear text over the message bus and break the JSON template if it contained quotes).
                    const raw = { ...(obj.message ?? {}) };
                    delete raw.password;
                    const { config, problems } = (0, Validation_1.normalizeConfig)({
                        ...this.config,
                        ...raw,
                    });
                    if (!config.host) {
                        reply({ ok: false, message: problems[0] ?? 'Host missing' });
                        return;
                    }
                    const http = this.buildHttp(config);
                    try {
                        const d = await (0, ProtocolDetector_1.detectProtocol)(http);
                        reply({
                            ok: d.status === 'ok',
                            status: d.status,
                            family: d.family,
                            device: d.controller?.device ?? null,
                            firmware: d.controller?.version ?? null,
                            message: (0, Sanitization_1.scrub)(d.message, [config.password]),
                            result: (0, Sanitization_1.scrub)(`${d.status}: ${d.message}${d.controller?.device ? ` (${d.controller.device} ${d.controller.version ?? ''})` : ''}`, [config.password]),
                        });
                    }
                    finally {
                        http.close();
                    }
                    break;
                }
                case 'rescan':
                    await this.rescan();
                    reply({ ok: true });
                    break;
                case 'inventory':
                    reply(this.catalog
                        ? { ok: true, ...(0, CapabilityRegistry_1.summarize)(this.catalog), result: JSON.stringify((0, CapabilityRegistry_1.summarize)(this.catalog)) }
                        : { ok: false, result: 'No discovery data yet' });
                    break;
                case 'exportDiagnostics':
                    reply({
                        ok: true,
                        result: JSON.stringify(this.diagnostics.exportAnonymized(this.cfg.host, this.catalog), null, 2),
                    });
                    break;
                default:
                    reply({ ok: false, message: `Unknown command ${obj.command}` });
            }
        }
        catch (err) {
            reply({ ok: false, message: (0, Sanitization_1.scrub)(err.message, this.secrets) });
        }
    }
    onUnload(callback) {
        this.unloading = true;
        try {
            this.polling?.stop();
            if (this.reconnectTimer) {
                clearTimeout(this.reconnectTimer);
            }
            if (this.diagTimer) {
                clearInterval(this.diagTimer);
            }
            this.http?.close();
            void this.setStateAsync('info.connection', { val: false, ack: true }).finally(callback);
        }
        catch {
            callback();
        }
    }
}
if (require.main !== module) {
    module.exports = (options) => new WindhagerAdapter(options);
}
else {
    (() => new WindhagerAdapter())();
}
