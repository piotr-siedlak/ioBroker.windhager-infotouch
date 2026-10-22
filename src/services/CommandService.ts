import type { WritableControllerApi } from '../api/ControllerApi';
import { WindhagerError } from '../api/errors';
import { isWritableByController } from '../discovery/CapabilityRegistry';
import type { Datapoint } from '../models/Datapoint';

export type WriteFailure =
    | 'disabled'
    | 'offline'
    | 'unknown-datapoint'
    | 'not-allowlisted'
    | 'not-writable'
    | 'invalid'
    | 'rejected'
    | 'unverified'
    | 'mismatch';

export type WriteOutcome =
    | { ok: true; value: number; verified: boolean }
    | { ok: false; code: WriteFailure; message: string; deviceValue?: number | null };

export interface CommandOptions {
    enabled: boolean;
    allowlist: ReadonlySet<string>;
    verify: boolean;
    isConnected(): boolean;
    findDatapoint(oid: string): Datapoint | undefined;
    /** Sanitised audit trail; never receives credentials. */
    audit(event: { oid: string; name: string; requested: unknown; outcome: string }): void;
    /** Read-back attempts before reporting a mismatch (default 3). */
    readbackAttempts?: number;
    /** Delay between read-back attempts (default 1000 ms). */
    readbackDelayMs?: number;
}

const EPSILON = 1e-6;

function decimals(step: number | null): number {
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
export function validateValue(
    dp: Datapoint,
    requested: unknown,
): { ok: true; value: number } | { ok: false; message: string } {
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
export class CommandService {
    private queue: Promise<unknown> = Promise.resolve();
    /** Injectable for tests. */
    public sleep: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms));

    public constructor(
        private readonly api: WritableControllerApi,
        private readonly options: CommandOptions,
    ) {}

    public write(oid: string, requested: unknown): Promise<WriteOutcome> {
        const run = this.queue.then(() => this.execute(oid, requested));
        this.queue = run.catch(() => undefined);
        return run;
    }

    private fail(
        dp: Datapoint | undefined,
        oid: string,
        requested: unknown,
        code: WriteFailure,
        message: string,
        deviceValue?: number | null,
    ): WriteOutcome {
        this.options.audit({ oid, name: dp?.name ?? '', requested, outcome: `refused:${code}` });
        return { ok: false, code, message, ...(deviceValue !== undefined ? { deviceValue } : {}) };
    }

    private async execute(oid: string, requested: unknown): Promise<WriteOutcome> {
        const { options } = this;
        if (!options.enabled) {
            return this.fail(undefined, oid, requested, 'disabled', 'Writes are disabled (read-only mode)');
        }
        if (!options.isConnected()) {
            return this.fail(undefined, oid, requested, 'offline', 'Controller is not connected');
        }
        const dp = options.findDatapoint(oid);
        if (!dp) {
            return this.fail(
                undefined,
                oid,
                requested,
                'unknown-datapoint',
                'Datapoint is not part of the discovered catalog',
            );
        }
        if (!options.allowlist.has(oid)) {
            return this.fail(dp, oid, requested, 'not-allowlisted', 'Datapoint is not in the write allow-list');
        }
        if (!isWritableByController(dp)) {
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
        } catch (err) {
            const message = err instanceof WindhagerError ? err.message : 'Write failed';
            return this.fail(dp, oid, requested, 'rejected', message);
        }

        if (!options.verify) {
            options.audit({ oid, name: dp.name, requested, outcome: 'sent:unverified' });
            return { ok: true, value: check.value, verified: false };
        }

        // The controller may apply a value with a short delay, so read back a few times before giving up.
        const tolerance = Math.max(EPSILON, (dp.step ?? 0) / 2);
        const attempts = Math.max(1, options.readbackAttempts ?? 3);
        let deviceValue: number | null = null;
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
            } catch {
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
            return this.fail(
                dp,
                oid,
                requested,
                'mismatch',
                `Controller reports ${deviceValue} instead of ${check.value}`,
                deviceValue,
            );
        }
        options.audit({ oid, name: dp.name, requested, outcome: 'confirmed' });
        return { ok: true, value: deviceValue, verified: true };
    }
}
