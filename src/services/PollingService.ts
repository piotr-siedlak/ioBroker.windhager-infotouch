import type { ControllerApi, GroupReadResult } from '../api/ControllerApi';
import { WindhagerError } from '../api/errors';
import type { PollCategory } from '../discovery/CapabilityRegistry';
import type { LonVariable, LookupGroup } from '../models/Datapoint';

export interface PollTarget {
    group: LookupGroup;
    category: PollCategory;
}

export interface PollingCallbacks {
    onGroup(group: LookupGroup, result: GroupReadResult): Promise<void>;
    onLon(group: LookupGroup, variables: LonVariable[]): Promise<void>;
    /** At least one full cycle succeeded after being offline (or first success). */
    onOnline(): void;
    /** Consecutive failures reached the threshold. */
    onOffline(err: Error): void;
    /** Authentication failed: polling stops to avoid lock-outs; user must fix credentials. */
    onAuthFailure(err: Error): void;
    onCycle?(category: PollCategory, durationMs: number, ok: boolean): void;
}

export interface PollingOptions {
    /** Seconds per category; 0 or undefined disables the category. */
    intervals: Partial<Record<PollCategory, number>>;
    includeLon: boolean;
    /** Failures in a row before the controller is considered offline. */
    offlineThreshold: number;
    maxBackoffFactor: number;
}

const DEFAULT_OPTIONS = { offlineThreshold: 3, maxBackoffFactor: 8 };

/**
 * One timer chain per category (never setInterval, so cycles cannot overlap). A group belongs to exactly
 * one category, which deduplicates polling. Repeated failures lengthen the interval (backoff).
 */
export class PollingService {
    private readonly timers = new Map<PollCategory, NodeJS.Timeout>();
    private targets: PollTarget[] = [];
    private running = false;
    private consecutiveFailures = 0;
    private online = false;
    private readonly options: PollingOptions;

    public constructor(
        private readonly api: ControllerApi,
        private readonly callbacks: PollingCallbacks,
        options: Pick<PollingOptions, 'intervals' | 'includeLon'> & Partial<PollingOptions>,
    ) {
        this.options = { ...DEFAULT_OPTIONS, ...options };
    }

    public setTargets(targets: PollTarget[]): void {
        this.targets = targets;
    }

    public get failures(): number {
        return this.consecutiveFailures;
    }

    public start(): void {
        this.running = true;
        for (const category of ['fast', 'normal', 'slow'] as const) {
            const seconds = this.options.intervals[category];
            if (seconds && seconds > 0) {
                // Stagger first runs slightly so categories do not hit the controller at the same instant.
                this.schedule(category, category === 'fast' ? 0 : category === 'normal' ? 1500 : 4000);
            }
        }
    }

    public stop(): void {
        this.running = false;
        for (const timer of this.timers.values()) {
            clearTimeout(timer);
        }
        this.timers.clear();
    }

    private schedule(category: PollCategory, delayMs: number): void {
        if (!this.running) {
            return;
        }
        this.timers.set(
            category,
            setTimeout(() => void this.runCycle(category), delayMs),
        );
    }

    /** Run one category now (also used by tests and for an immediate refresh after a write). */
    public async runCycle(category: PollCategory): Promise<boolean> {
        const started = Date.now();
        let ok = true;
        try {
            for (const target of this.targets.filter(t => t.category === category)) {
                if (!this.running) {
                    return false;
                }
                const result = await this.api.readGroup(
                    target.group.nodeId,
                    target.group.fctId,
                    target.group.lookupId,
                    target.group.count,
                );
                await this.callbacks.onGroup(target.group, result);
                if (this.options.includeLon && category === 'slow' && target.group.lon.length > 0) {
                    await this.pollLon(target.group);
                }
            }
            this.recordSuccess();
        } catch (err) {
            ok = false;
            this.recordFailure(err instanceof Error ? err : new Error(String(err)));
        }
        this.callbacks.onCycle?.(category, Date.now() - started, ok);

        const base = (this.options.intervals[category] ?? 0) * 1000;
        const factor = Math.min(this.options.maxBackoffFactor, 2 ** Math.max(0, this.consecutiveFailures - 1));
        this.schedule(category, base * (ok ? 1 : factor));
        return ok;
    }

    private async pollLon(group: LookupGroup): Promise<void> {
        const values: LonVariable[] = [];
        for (const nv of group.lon) {
            if (!this.running) {
                return;
            }
            const fresh = await this.api.readLonValue(nv.nodeId, nv.fctId, nv.lookupId, nv.index);
            if (fresh) {
                values.push(fresh);
            }
        }
        await this.callbacks.onLon(group, values);
    }

    private recordSuccess(): void {
        this.consecutiveFailures = 0;
        if (!this.online) {
            this.online = true;
            this.callbacks.onOnline();
        }
    }

    private recordFailure(err: Error): void {
        if (err instanceof WindhagerError && err.kind === 'auth') {
            this.stop();
            this.online = false;
            this.callbacks.onAuthFailure(err);
            return;
        }
        this.consecutiveFailures++;
        if (this.online && this.consecutiveFailures >= this.options.offlineThreshold) {
            this.online = false;
            this.callbacks.onOffline(err);
        } else if (!this.online && this.consecutiveFailures === this.options.offlineThreshold) {
            this.callbacks.onOffline(err);
        }
    }
}
