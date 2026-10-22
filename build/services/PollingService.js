"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PollingService = void 0;
const errors_1 = require("../api/errors");
const DEFAULT_OPTIONS = { offlineThreshold: 3, maxBackoffFactor: 8 };
/**
 * One timer chain per category (never setInterval, so cycles cannot overlap). A group belongs to exactly
 * one category, which deduplicates polling. Repeated failures lengthen the interval (backoff).
 */
class PollingService {
    api;
    callbacks;
    timers = new Map();
    targets = [];
    running = false;
    consecutiveFailures = 0;
    online = false;
    inFlight = new Set();
    options;
    constructor(api, callbacks, options) {
        this.api = api;
        this.callbacks = callbacks;
        this.options = { ...DEFAULT_OPTIONS, ...options };
    }
    setTargets(targets) {
        this.targets = targets;
    }
    get failures() {
        return this.consecutiveFailures;
    }
    start() {
        this.running = true;
        for (const category of ['fast', 'normal', 'slow']) {
            const seconds = this.options.intervals[category];
            // A category without targets is never scheduled: an empty cycle proves nothing about the controller.
            if (seconds && seconds > 0 && this.hasTargets(category)) {
                // Stagger first runs slightly so categories do not hit the controller at the same instant.
                this.schedule(category, category === 'fast' ? 0 : category === 'normal' ? 1500 : 4000);
            }
        }
    }
    stop() {
        this.running = false;
        for (const timer of this.timers.values()) {
            clearTimeout(timer);
        }
        this.timers.clear();
    }
    hasTargets(category) {
        return this.targets.some(t => t.category === category);
    }
    schedule(category, delayMs) {
        // Replace, never add: one chain per category even if runCycle() is also called directly.
        const existing = this.timers.get(category);
        if (existing) {
            clearTimeout(existing);
            this.timers.delete(category);
        }
        if (!this.running || !(this.options.intervals[category] ?? 0)) {
            return;
        }
        this.timers.set(category, setTimeout(() => void this.runCycle(category), delayMs));
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
    async runCycle(category) {
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
            let lastError = null;
            for (const target of targets) {
                if (!this.running) {
                    return false;
                }
                try {
                    const result = await this.api.readGroup(target.group.nodeId, target.group.fctId, target.group.lookupId, target.group.count);
                    await this.callbacks.onGroup(target.group, result);
                    if (this.options.includeLon && category === 'slow' && target.group.lon.length > 0) {
                        await this.pollLon(target.group);
                    }
                    succeeded++;
                }
                catch (err) {
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
        }
        catch (err) {
            ok = false;
            this.recordFailure(err instanceof Error ? err : new Error(String(err)));
        }
        finally {
            this.inFlight.delete(category);
        }
        this.callbacks.onCycle?.(category, Date.now() - started, ok);
        const base = (this.options.intervals[category] ?? 0) * 1000;
        const factor = Math.min(this.options.maxBackoffFactor, 2 ** Math.max(0, this.consecutiveFailures - 1));
        this.schedule(category, base * (ok ? 1 : factor));
        return ok;
    }
    async pollLon(group) {
        const values = [];
        for (const nv of group.lon) {
            if (!this.running) {
                return;
            }
            try {
                const fresh = await this.api.readLonValue(nv.nodeId, nv.fctId, nv.lookupId, nv.index);
                if (fresh) {
                    values.push(fresh);
                }
            }
            catch (err) {
                if (isFatal(err)) {
                    throw err;
                }
                // One unreadable variable must not drop the others.
            }
        }
        await this.callbacks.onLon(group, values);
    }
    recordSuccess() {
        this.consecutiveFailures = 0;
        if (!this.online) {
            this.online = true;
            this.callbacks.onOnline();
        }
    }
    recordFailure(err) {
        if (err instanceof errors_1.WindhagerError && err.kind === 'auth') {
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
exports.PollingService = PollingService;
function isFatal(err) {
    return (err instanceof errors_1.WindhagerError && (err.kind === 'auth' || err.kind === 'connection' || err.kind === 'timeout'));
}
