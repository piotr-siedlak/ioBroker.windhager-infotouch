"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DiagnosticsService = void 0;
const CapabilityRegistry_1 = require("../discovery/CapabilityRegistry");
const Sanitization_1 = require("../utils/Sanitization");
const HISTORY_LIMIT = 50;
class DiagnosticsService {
    requests = 0;
    failures = 0;
    latencySum = 0;
    latencyCount = 0;
    lastLatency = 0;
    maxLatency = 0;
    consecutive = 0;
    lastError = '';
    lastSuccessAt = null;
    history = [];
    events = [];
    record(metric) {
        this.requests++;
        if (metric.error) {
            this.failures++;
            this.consecutive++;
            this.lastError = metric.error;
            this.pushHistory(`${metric.method} ${metric.path}: ${metric.error}`);
        }
        else {
            this.consecutive = 0;
            this.lastSuccessAt = Date.now();
            this.lastLatency = metric.durationMs;
            this.latencySum += metric.durationMs;
            this.latencyCount++;
            this.maxLatency = Math.max(this.maxLatency, metric.durationMs);
        }
    }
    note(event) {
        this.events.push(`${new Date().toISOString()} ${event}`);
        if (this.events.length > HISTORY_LIMIT) {
            this.events.shift();
        }
    }
    pushHistory(message) {
        this.history.push({ at: new Date().toISOString(), message });
        if (this.history.length > HISTORY_LIMIT) {
            this.history.shift();
        }
    }
    snapshot() {
        return {
            requests: this.requests,
            failures: this.failures,
            lastLatencyMs: this.lastLatency,
            avgLatencyMs: this.latencyCount ? Math.round(this.latencySum / this.latencyCount) : 0,
            maxLatencyMs: this.maxLatency,
            consecutiveFailures: this.consecutive,
            lastError: this.lastError,
            lastSuccessAt: this.lastSuccessAt,
        };
    }
    /**
     * Anonymised export suitable for attaching to a bug report: IP/host and controller serials are masked,
     * no credentials or auth headers are ever recorded, and no datapoint values are included.
     *
     * @param host Configured host
     * @param catalog Current catalog, if any
     */
    exportAnonymized(host, catalog) {
        const data = {
            generatedAt: new Date().toISOString(),
            host: (0, Sanitization_1.maskHost)(host),
            stats: this.snapshot(),
            errorHistory: this.history,
            events: this.events,
            controller: catalog?.controller ?? null,
            catalog: catalog
                ? {
                    ...(0, CapabilityRegistry_1.summarize)(catalog),
                    discoveredAt: new Date(catalog.discoveredAt).toISOString(),
                    skipped: catalog.skipped,
                    modules: catalog.modules.map(m => ({
                        nodeId: m.nodeId,
                        name: m.name,
                        programId: (0, Sanitization_1.maskSerial)(m.programId),
                        neuronId: (0, Sanitization_1.maskSerial)(m.neuronId),
                        functions: m.functions.map(f => ({
                            fctId: f.fctId,
                            fctType: f.fctType,
                            locked: f.locked,
                            groups: f.lookups.length,
                        })),
                    })),
                }
                : null,
        };
        // Error texts from Node (e.g. "connect ECONNREFUSED 192.168.1.5:80") embed the address: mask every occurrence.
        const text = host ? JSON.stringify(data).split(host).join((0, Sanitization_1.maskHost)(host)) : JSON.stringify(data);
        return JSON.parse(text);
    }
}
exports.DiagnosticsService = DiagnosticsService;
