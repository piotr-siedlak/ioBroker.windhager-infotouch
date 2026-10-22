import type { ControllerApi, GroupReadResult } from '../api/ControllerApi';
import { WindhagerError } from '../api/errors';
import type { PollCategory } from '../discovery/CapabilityRegistry';
import { DIRECT_GROUP_ID } from '../discovery/SystemScanner';
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
    /** A single group failed with a non-fatal error and was skipped in this cycle. */
    onGroupError?(group: LookupGroup, err: Error): void;
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
    private readonly inFlight = new Set<PollCategory>();
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
            // A category without targets is never scheduled: an empty cycle proves nothing about the controller.
            if (seconds && seconds > 0 && this.hasTargets(category)) {
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

    private hasTargets(category: PollCategory): boolean {
        return this.targets.some(t => t.category === category);
    }

    private schedule(category: PollCategory, delayMs: number): void {
        // Replace, never add: one chain per category even if runCycle() is also called directly.
        const existing = this.timers.get(category);
        if (existing) {
            clearTimeout(existing);
            this.timers.delete(category);
        }
        if (!this.running || !(this.options.intervals[category] ?? 0)) {
            return;
        }
        this.timers.set(
            category,
            setTimeout(() => void this.runCycle(category), delayMs),
        );
    }

    /**
     * Run one category now. Concurrent calls for the same category are coalesced.
     *
     * Groups failing with a non-fatal error (HTTP status, malformed payload) are skipped so that one bad group
     * cannot make the controller look offline. Connectivity errors abort the cycle and count as a failure.
     * A cycle in which every group failed also counts as a failure.
     *
     * @param category Category to poll
     * @returns true if the cycle reached the controller successfully
     */
    public async runCycle(category: PollCategory): Promise<boolean> {
        if (this.inFlight.has(category)) {
            return false;
        }
        const targets = this.targets.filter(t => t.category === category);
        if (targets.length === 0) {
            return false;
        }
        this.inFlight.add(category);
        const started = Date.now();
        let ok = true;
        try {
            let succeeded = 0;
            let lastError: Error | null = null;
            for (const target of targets) {
                if (!this.running) {
                    return false;
                }
                try {
                    const result =
                        target.group.lookupId === DIRECT_GROUP_ID
                            ? await this.readDirect(target.group)
                            : await this.api.readGroup(
                                  target.group.nodeId,
                                  target.group.fctId,
                                  target.group.lookupId,
                                  target.group.count,
                              );
                    await this.callbacks.onGroup(target.group, result);
                    if (this.options.includeLon && category === 'slow' && target.group.lon.length > 0) {
                        await this.pollLon(target.group);
                    }
                    succeeded++;
                } catch (err) {
                    if (isFatal(err)) {
                        throw err;
                    }
                    lastError = err instanceof Error ? err : new Error(String(err));
                    this.callbacks.onGroupError?.(target.group, lastError);
                }
            }
            if (succeeded === 0 && lastError) {
                throw lastError;
            }
            this.recordSuccess();
        } catch (err) {
            ok = false;
            this.recordFailure(err instanceof Error ? err : new Error(String(err)));
        } finally {
            this.inFlight.delete(category);
        }
        this.callbacks.onCycle?.(category, Date.now() - started, ok);

        const base = (this.options.intervals[category] ?? 0) * 1000;
        const factor = Math.min(this.options.maxBackoffFactor, 2 ** Math.max(0, this.consecutiveFailures - 1));
        this.schedule(category, base * (ok ? 1 : factor));
        return ok;
    }

    /** Datapoints listed in no menu are read one by one (structured objects are left to the object reader). */
    private async readDirect(group: LookupGroup): Promise<GroupReadResult> {
        const result: GroupReadResult = { datapoints: [], lon: [], skipped: 0 };
        for (const dp of group.datapoints) {
            if (dp.typeId === 30 || !this.running) {
                continue;
            }
            const fresh = await this.api.readDatapoint(dp.oid);
            if (fresh) {
                result.datapoints.push(fresh);
            } else {
                result.skipped++;
            }
        }
        return result;
    }

    private async pollLon(group: LookupGroup): Promise<void> {
        const values: LonVariable[] = [];
        for (const nv of group.lon) {
            if (!this.running) {
                return;
            }
            try {
                const fresh = await this.api.readLonValue(nv.nodeId, nv.fctId, nv.lookupId, nv.index);
                if (fresh) {
                    values.push(fresh);
                }
            } catch (err) {
                if (isFatal(err)) {
                    throw err;
                }
                // One unreadable variable must not drop the others.
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
        if (this.consecutiveFailures === this.options.offlineThreshold) {
            this.online = false;
            this.callbacks.onOffline(err);
        }
    }
}

function isFatal(err: unknown): boolean {
    return (
        err instanceof WindhagerError && (err.kind === 'auth' || err.kind === 'connection' || err.kind === 'timeout')
    );
}
