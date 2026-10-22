import * as utils from '@iobroker/adapter-core';
import type { WritableControllerApi } from './api/ControllerApi';
import { WindhagerError } from './api/errors';
import { HttpClient } from './api/HttpClient';
import { detectProtocol, type DetectionResult } from './api/ProtocolDetector';
import { categorize, indexCatalog, isCacheValid, summarize, type CatalogIndex } from './discovery/CapabilityRegistry';
import { scanSystem } from './discovery/SystemScanner';
import { CATALOG_SCHEMA_VERSION, scanFingerprint, type Catalog } from './models/Datapoint';
import { CommandService } from './services/CommandService';
import { DiagnosticsService } from './services/DiagnosticsService';
import { PollingService, type PollTarget } from './services/PollingService';
import { readSchedules } from './services/ScheduleService';
import { StateRegistry, type AdapterPort } from './services/StateRegistry';
import { scrub } from './utils/Sanitization';
import { normalizeConfig, type AdapterConfig, type NormalizedConfig } from './utils/Validation';

const CACHE_OBJECT = 'cache';
const CACHE_FILE = 'catalog.json';
const RECONNECT_MIN_MS = 30_000;
const RECONNECT_MAX_MS = 10 * 60_000;

class WindhagerAdapter extends utils.Adapter {
    private cfg!: NormalizedConfig;
    private http: HttpClient | null = null;
    private api: WritableControllerApi | null = null;
    private catalog: Catalog | null = null;
    private index: CatalogIndex | null = null;
    private registry: StateRegistry | null = null;
    private polling: PollingService | null = null;
    private commands: CommandService | null = null;
    private readonly diagnostics = new DiagnosticsService();
    private controllerOnline = false;
    private reconnectTimer: NodeJS.Timeout | null = null;
    private diagTimer: NodeJS.Timeout | null = null;
    private reconnectDelay = RECONNECT_MIN_MS;
    private unloading = false;
    private busy = false;

    public constructor(options: Partial<utils.AdapterOptions> = {}) {
        super({ ...options, name: 'windhager-infotouch' });
        this.on('ready', () => void this.onReady());
        this.on('stateChange', (id, state) => void this.onStateChange(id, state));
        this.on('message', obj => void this.onMessage(obj));
        this.on('unload', callback => this.onUnload(callback));
    }

    private get secrets(): string[] {
        return [this.cfg?.password ?? ''];
    }

    private logSafe(level: 'debug' | 'info' | 'warn' | 'error', message: string): void {
        this.log[level](scrub(message, this.secrets));
    }

    private async onReady(): Promise<void> {
        await this.setConnected(false);
        const { config, problems } = normalizeConfig(this.config);
        this.cfg = config;
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
        this.logSafe(
            'info',
            config.writesEnabled
                ? `Write mode ENABLED for ${config.writeAllowlist.size} allow-listed datapoint(s)`
                : 'Read-only mode (default)',
        );
        await this.extendObject(CACHE_OBJECT, {
            type: 'meta',
            common: { name: 'Cache', type: 'meta.user' },
            native: {},
        });
        this.diagTimer = setInterval(() => void this.publishDiagnostics(), 30_000);
        await this.subscribeStatesAsync('diagnostics.rescan');
        await this.connect();
    }

    private async setConnected(value: boolean): Promise<void> {
        this.controllerOnline = value;
        await this.setStateChangedAsync('info.connection', { val: value, ack: true });
    }

    private buildHttp(config: NormalizedConfig): HttpClient {
        const http = new HttpClient({
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
    private async connect(): Promise<void> {
        if (this.unloading || this.busy) {
            return;
        }
        this.busy = true;
        try {
            this.http?.close();
            this.http = this.buildHttp(this.cfg);
            const detection = await detectProtocol(this.http);
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
        } catch (err) {
            await this.handleRuntimeError(err);
        } finally {
            this.busy = false;
        }
    }

    private async handleDetectionFailure(detection: DetectionResult): Promise<void> {
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
        } else {
            this.logSafe(
                'warn',
                `Controller not reachable (${detection.message}); retrying in ${Math.round(this.reconnectDelay / 1000)} s`,
            );
        }
        this.scheduleReconnect();
    }

    private async handleRuntimeError(err: unknown): Promise<void> {
        const message = err instanceof Error ? err.message : String(err);
        await this.setStateAsync('info.lastError', { val: message, ack: true });
        if (err instanceof WindhagerError && err.kind === 'auth') {
            this.logSafe('error', 'Authentication failed. Check user name and password, then restart the instance.');
            return;
        }
        this.logSafe('warn', `Connect failed: ${message}`);
        this.scheduleReconnect();
    }

    private scheduleReconnect(): void {
        if (this.unloading) {
            return;
        }
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
        }
        this.reconnectTimer = setTimeout(() => void this.connect(), this.reconnectDelay);
        this.reconnectDelay = Math.min(RECONNECT_MAX_MS, this.reconnectDelay * 2);
    }

    private async readCache(): Promise<Catalog | null> {
        try {
            const file = await this.readFileAsync(`${this.namespace}.${CACHE_OBJECT}`, CACHE_FILE);
            const parsed = JSON.parse(String(file.file)) as Catalog;
            return parsed?.schemaVersion === CATALOG_SCHEMA_VERSION ? parsed : null;
        } catch {
            return null;
        }
    }

    private async loadOrScan(detection: DetectionResult): Promise<Catalog> {
        const api = this.api as WritableControllerApi;
        const cached = await this.readCache();
        if (cached) {
            const modules = await api.listModules();
            const maxAge = this.cfg.cacheMaxAgeHours * 3_600_000;
            const current = {
                modules,
                version: detection.controller?.version ?? null,
                scanOptions: scanFingerprint({ excludedNodes: this.cfg.excludedNodes, includeLon: this.cfg.pollLon }),
            };
            if (isCacheValid(cached, current, maxAge)) {
                this.logSafe('info', 'Using cached discovery (module list, firmware and discovery options unchanged)');
                return cached;
            }
            this.logSafe('info', 'Cached discovery is outdated - rescanning');
        }
        return this.scan();
    }

    private async scan(): Promise<Catalog> {
        const api = this.api as WritableControllerApi;
        this.logSafe('info', 'Discovering controller structure (read-only)...');
        const catalog = await scanSystem(api, {
            excludedNodes: this.cfg.excludedNodes,
            includeLon: this.cfg.pollLon,
            log: m => this.logSafe('debug', m),
        });
        try {
            await this.writeFileAsync(`${this.namespace}.${CACHE_OBJECT}`, CACHE_FILE, JSON.stringify(catalog));
        } catch (err) {
            this.logSafe('warn', `Could not store discovery cache: ${(err as Error).message}`);
        }
        const s = summarize(catalog);
        this.diagnostics.note(`Scan: ${s.modules} modules, ${s.datapoints} datapoints, ${catalog.skipped} skipped`);
        return catalog;
    }

    private createPort(): AdapterPort {
        return {
            extendObject: async (id, obj) => {
                await this.extendObject(id, obj as unknown as ioBroker.SettableObject);
            },
            setStateChanged: async (id, state) => {
                await this.setStateChangedAsync(id, state as ioBroker.SettableState);
            },
            listObjects: async prefix => {
                const start = `${this.namespace}.${prefix}`;
                const view = await this.getObjectViewAsync('system', 'state', {
                    startkey: start,
                    endkey: `${start}\u9999`,
                });
                return (view.rows ?? []).map(row => ({
                    id: row.id.slice(this.namespace.length + 1),
                    type: 'state',
                    native: (row.value?.native ?? {}) as Record<string, unknown>,
                }));
            },
        };
    }

    private async startServices(): Promise<void> {
        const api = this.api as WritableControllerApi;
        const catalog = this.catalog as Catalog;
        this.polling?.stop();

        this.index = indexCatalog(catalog);
        this.registry = new StateRegistry(this.createPort(), {
            writesEnabled: this.cfg.writesEnabled,
            writeAllowlist: this.cfg.writeAllowlist,
            exposeRaw: this.cfg.exposeRaw,
            includeLon: this.cfg.pollLon,
        });
        const sync = await this.registry.sync(catalog);
        this.logSafe(
            'info',
            `Objects ready: ${sync.datapoints} datapoints, ${sync.stale} newly stale, ${sync.revived} revived`,
        );

        const index = this.index;
        this.commands = new CommandService(api, {
            enabled: this.cfg.writesEnabled,
            allowlist: this.cfg.writeAllowlist,
            verify: this.cfg.verifyWrites,
            isConnected: () => this.controllerOnline,
            findDatapoint: oid => index.byOid.get(oid),
            audit: e =>
                this.logSafe(
                    'info',
                    `AUDIT write ${e.oid} "${e.name}" requested=${String(e.requested)} -> ${e.outcome}`,
                ),
        });
        for (const oid of this.cfg.writeAllowlist) {
            const id = this.registry.writableStateFor(oid);
            if (id) {
                await this.subscribeStatesAsync(id);
            } else {
                this.logSafe(
                    'warn',
                    `Allow-listed OID ${oid} is not a writable datapoint on this controller - ignored`,
                );
            }
        }

        const targets: PollTarget[] = [...index.groups.values()].map(group => ({
            group,
            category:
                group.datapoints.length === 0 && group.lon.length > 0 ? 'slow' : categorize(group, this.cfg.fastGroups),
        }));
        this.polling = new PollingService(
            api,
            {
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
                    void this.setStateAsync('info.lastError', { val: scrub(err.message, this.secrets), ack: true });
                },
                onAuthFailure: err => {
                    this.logSafe(
                        'error',
                        `Authentication failed while polling (${err.message}); polling stopped to avoid account lock-out`,
                    );
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
            },
            {
                intervals: {
                    fast: this.cfg.enableFast ? this.cfg.pollFastSec : 0,
                    normal: this.cfg.enableNormal ? this.cfg.pollNormalSec : 0,
                    slow: this.cfg.enableSlow ? this.cfg.pollSlowSec : 0,
                },
                includeLon: this.cfg.pollLon,
            },
        );
        this.polling.setTargets(targets);
        this.polling.start();
        await this.publishDiagnostics();
    }

    private lastScheduleRead = 0;

    /** Schedules are read at most every 15 min, stored verbatim and read-only (experimental). */
    private async maybePollSchedules(): Promise<void> {
        if (!this.api || !this.catalog || Date.now() - this.lastScheduleRead < 15 * 60_000) {
            return;
        }
        this.lastScheduleRead = Date.now();
        for (const s of await readSchedules(this.api, this.catalog)) {
            const id = `schedules.${s.key.replace(/\./g, '_')}`;
            await this.extendObject(id, {
                type: 'state',
                common: { name: s.name || s.oid, type: 'string', role: 'json', read: true, write: false },
                native: { oid: s.oid, key: s.key, experimental: true },
            });
            await this.setStateChangedAsync(id, { val: s.json, ack: true });
        }
    }

    private async publishDiagnostics(): Promise<void> {
        const d = this.diagnostics.snapshot();
        await this.setStateChangedAsync('diagnostics.requests', { val: d.requests, ack: true });
        await this.setStateChangedAsync('diagnostics.failures', { val: d.failures, ack: true });
        await this.setStateChangedAsync('diagnostics.lastLatencyMs', { val: d.lastLatencyMs, ack: true });
        await this.setStateChangedAsync('diagnostics.avgLatencyMs', { val: d.avgLatencyMs, ack: true });
        await this.setStateChangedAsync('diagnostics.consecutiveFailures', { val: d.consecutiveFailures, ack: true });
        if (this.catalog) {
            await this.setStateChangedAsync('diagnostics.datapoints', {
                val: summarize(this.catalog).datapoints,
                ack: true,
            });
            await this.setStateChangedAsync('diagnostics.catalogAgeHours', {
                val: Math.round((Date.now() - this.catalog.discoveredAt) / 3_600_000),
                ack: true,
            });
        }
    }

    private async rescan(): Promise<void> {
        if (!this.api || this.busy) {
            throw new Error('Not connected or busy');
        }
        this.busy = true;
        try {
            this.polling?.stop();
            try {
                this.catalog = await this.scan();
            } catch (err) {
                // Keep serving the previous catalog: a failed rescan must not silently stop polling.
                if (this.catalog) {
                    await this.startServices();
                }
                throw err;
            }
            await this.startServices();
        } finally {
            this.busy = false;
        }
    }

    private async onStateChange(id: string, state: ioBroker.State | null | undefined): Promise<void> {
        if (!state || state.ack) {
            return;
        }
        const rel = id.slice(this.namespace.length + 1);
        if (rel === 'diagnostics.rescan') {
            if (state.val === true) {
                try {
                    await this.rescan();
                } catch (err) {
                    this.logSafe('warn', `Rescan failed: ${(err as Error).message}`);
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
    private async restoreFromDevice(oid: string, rel: string, deviceValue?: number | null): Promise<void> {
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
        } catch {
            // Offline: polling will resynchronise once the controller is back.
        }
    }

    private async onMessage(obj: ioBroker.Message): Promise<void> {
        if (!obj?.command || !obj.callback) {
            return;
        }
        const reply = (result: unknown): void => {
            this.sendTo(obj.from, obj.command, result, obj.callback);
        };
        try {
            switch (obj.command) {
                case 'testConnection': {
                    // The admin form sends unsaved connection fields but never the password (it would travel in
                    // clear text over the message bus and break the JSON template if it contained quotes).
                    const raw = { ...((obj.message ?? {}) as Partial<AdapterConfig>) };
                    delete raw.password;
                    const { config, problems } = normalizeConfig({
                        ...(this.config as unknown as Partial<AdapterConfig>),
                        ...raw,
                    });
                    if (!config.host) {
                        reply({ ok: false, message: problems[0] ?? 'Host missing' });
                        return;
                    }
                    const http = this.buildHttp(config);
                    try {
                        const d = await detectProtocol(http);
                        reply({
                            ok: d.status === 'ok',
                            status: d.status,
                            family: d.family,
                            device: d.controller?.device ?? null,
                            firmware: d.controller?.version ?? null,
                            message: scrub(d.message, [config.password]),
                            result: scrub(
                                `${d.status}: ${d.message}${d.controller?.device ? ` (${d.controller.device} ${d.controller.version ?? ''})` : ''}`,
                                [config.password],
                            ),
                        });
                    } finally {
                        http.close();
                    }
                    break;
                }
                case 'rescan':
                    await this.rescan();
                    reply({ ok: true });
                    break;
                case 'inventory':
                    reply(
                        this.catalog
                            ? { ok: true, ...summarize(this.catalog), result: JSON.stringify(summarize(this.catalog)) }
                            : { ok: false, result: 'No discovery data yet' },
                    );
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
        } catch (err) {
            reply({ ok: false, message: scrub((err as Error).message, this.secrets) });
        }
    }

    private onUnload(callback: () => void): void {
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
        } catch {
            callback();
        }
    }
}

if (require.main !== module) {
    module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new WindhagerAdapter(options);
} else {
    (() => new WindhagerAdapter())();
}
