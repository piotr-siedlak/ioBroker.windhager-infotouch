"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CommandService = void 0;
exports.validateValue = validateValue;
const errors_1 = require("../api/errors");
const CapabilityRegistry_1 = require("../discovery/CapabilityRegistry");
const EPSILON = 1e-6;
function decimals(step) {
    if (step === null) {
        return 3;
    }
    const s = String(step);
    const dot = s.indexOf('.');
    return dot < 0 ? 0 : s.length - dot - 1;
}
/**
 * Validate a requested value against the controller-provided metadata. Pure function.
 *
 * @param dp Target datapoint
 * @param requested Value from the user
 */
function validateValue(dp, requested) {
    if (typeof requested !== 'number' || !Number.isFinite(requested)) {
        return { ok: false, message: 'Value must be a finite number' };
    }
    if (dp.enumValues) {
        return dp.enumValues.includes(requested)
            ? { ok: true, value: requested }
            : { ok: false, message: `Value ${requested} is not one of [${dp.enumValues.join(', ')}]` };
    }
    if (dp.min !== null && requested < dp.min - EPSILON) {
        return { ok: false, message: `Value ${requested} is below the minimum ${dp.min}` };
    }
    if (dp.max !== null && requested > dp.max + EPSILON) {
        return { ok: false, message: `Value ${requested} is above the maximum ${dp.max}` };
    }
    if (dp.step !== null && dp.step > 0) {
        const origin = dp.min ?? 0;
        const steps = (requested - origin) / dp.step;
        if (Math.abs(steps - Math.round(steps)) > 1e-4) {
            return { ok: false, message: `Value ${requested} is not a multiple of step ${dp.step}` };
        }
    }
    return { ok: true, value: requested };
}
/**
 * Serialised, validated, verified writes. Every refusal returns a typed reason; nothing is sent unless every
 * check passes, and success is only reported after the value was read back from the controller.
 */
class CommandService {
    api;
    options;
    queue = Promise.resolve();
    /** Injectable for tests. */
    sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    constructor(api, options) {
        this.api = api;
        this.options = options;
    }
    write(oid, requested) {
        const run = this.queue.then(() => this.execute(oid, requested));
        this.queue = run.catch(() => undefined);
        return run;
    }
    fail(dp, oid, requested, code, message, deviceValue) {
        this.options.audit({ oid, name: dp?.name ?? '', requested, outcome: `refused:${code}` });
        return { ok: false, code, message, ...(deviceValue !== undefined ? { deviceValue } : {}) };
    }
    async execute(oid, requested) {
        const { options } = this;
        if (!options.enabled) {
            return this.fail(undefined, oid, requested, 'disabled', 'Writes are disabled (read-only mode)');
        }
        if (!options.isConnected()) {
            return this.fail(undefined, oid, requested, 'offline', 'Controller is not connected');
        }
        const dp = options.findDatapoint(oid);
        if (!dp) {
            return this.fail(undefined, oid, requested, 'unknown-datapoint', 'Datapoint is not part of the discovered catalog');
        }
        if (!options.allowlist.has(oid)) {
            return this.fail(dp, oid, requested, 'not-allowlisted', 'Datapoint is not in the write allow-list');
        }
        if (!(0, CapabilityRegistry_1.isWritableByController)(dp)) {
            return this.fail(dp, oid, requested, 'not-writable', 'Controller does not mark this datapoint as writable');
        }
        const check = validateValue(dp, requested);
        if (!check.ok) {
            return this.fail(dp, oid, requested, 'invalid', check.message);
        }
        const payload = check.value
            .toFixed(decimals(dp.step))
            .replace(/(\.\d*?)0+$/, '$1')
            .replace(/\.$/, '');
        try {
            await this.api.writeDatapoint(oid, payload);
        }
        catch (err) {
            const message = err instanceof errors_1.WindhagerError ? err.message : 'Write failed';
            return this.fail(dp, oid, requested, 'rejected', message);
        }
        if (!options.verify) {
            options.audit({ oid, name: dp.name, requested, outcome: 'sent:unverified' });
            return { ok: true, value: check.value, verified: false };
        }
        // The controller may apply a value with a short delay, so read back a few times before giving up.
        const tolerance = Math.max(EPSILON, (dp.step ?? 0) / 2);
        const attempts = Math.max(1, options.readbackAttempts ?? 3);
        let deviceValue = null;
        let readFailed = false;
        for (let attempt = 0; attempt < attempts; attempt++) {
            if (attempt > 0) {
                await this.sleep(options.readbackDelayMs ?? 1000);
            }
            try {
                const after = await this.api.readDatapoint(oid);
                const n = after?.value !== null && after?.value !== undefined ? Number(after.value) : NaN;
                deviceValue = Number.isFinite(n) ? n : null;
                readFailed = false;
            }
            catch {
                readFailed = true;
                continue;
            }
            if (deviceValue !== null && Math.abs(deviceValue - check.value) <= tolerance) {
                break;
            }
        }
        if (readFailed) {
            return this.fail(dp, oid, requested, 'unverified', 'Value was sent but could not be read back');
        }
        if (deviceValue === null) {
            return this.fail(dp, oid, requested, 'unverified', 'Controller returned no value on read-back');
        }
        if (Math.abs(deviceValue - check.value) > tolerance) {
            return this.fail(dp, oid, requested, 'mismatch', `Controller reports ${deviceValue} instead of ${check.value}`, deviceValue);
        }
        options.audit({ oid, name: dp.name, requested, outcome: 'confirmed' });
        return { ok: true, value: deviceValue, verified: true };
    }
}
exports.CommandService = CommandService;
