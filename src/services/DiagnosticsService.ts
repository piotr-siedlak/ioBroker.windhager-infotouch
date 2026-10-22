import type { RequestMetric } from '../api/HttpClient';
import type { Catalog } from '../models/Datapoint';
import { summarize } from '../discovery/CapabilityRegistry';
import { maskHost, maskSerial } from '../utils/Sanitization';

export interface ErrorRecord {
    at: string;
    message: string;
}

export interface DiagnosticsSnapshot {
    requests: number;
    failures: number;
    lastLatencyMs: number;
    avgLatencyMs: number;
    maxLatencyMs: number;
    consecutiveFailures: number;
    lastError: string;
    lastSuccessAt: number | null;
}

const HISTORY_LIMIT = 50;

export class DiagnosticsService {
    private requests = 0;
    private failures = 0;
    private latencySum = 0;
    private latencyCount = 0;
    private lastLatency = 0;
    private maxLatency = 0;
    private consecutive = 0;
    private lastError = '';
    private lastSuccessAt: number | null = null;
    private readonly history: ErrorRecord[] = [];
    private readonly events: string[] = [];

    public record(metric: RequestMetric): void {
        this.requests++;
        if (metric.error) {
            this.failures++;
            this.consecutive++;
            this.lastError = metric.error;
            this.pushHistory(`${metric.method} ${metric.path}: ${metric.error}`);
        } else {
            this.consecutive = 0;
            this.lastSuccessAt = Date.now();
            this.lastLatency = metric.durationMs;
            this.latencySum += metric.durationMs;
            this.latencyCount++;
            this.maxLatency = Math.max(this.maxLatency, metric.durationMs);
        }
    }

    public note(event: string): void {
        this.events.push(`${new Date().toISOString()} ${event}`);
        if (this.events.length > HISTORY_LIMIT) {
            this.events.shift();
        }
    }

    private pushHistory(message: string): void {
        this.history.push({ at: new Date().toISOString(), message });
        if (this.history.length > HISTORY_LIMIT) {
            this.history.shift();
        }
    }

    public snapshot(): DiagnosticsSnapshot {
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
    public exportAnonymized(host: string, catalog: Catalog | null): Record<string, unknown> {
        return {
            generatedAt: new Date().toISOString(),
            host: maskHost(host),
            stats: this.snapshot(),
            errorHistory: this.history,
            events: this.events,
            controller: catalog?.controller ?? null,
            catalog: catalog
                ? {
                      ...summarize(catalog),
                      discoveredAt: new Date(catalog.discoveredAt).toISOString(),
                      skipped: catalog.skipped,
                      modules: catalog.modules.map(m => ({
                          nodeId: m.nodeId,
                          name: m.name,
                          programId: maskSerial(m.programId),
                          neuronId: maskSerial(m.neuronId),
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
    }
}
