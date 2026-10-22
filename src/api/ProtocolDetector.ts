import type { ControllerInfo } from '../models/Datapoint';
import type { WritableControllerApi } from './ControllerApi';
import { WindhagerError } from './errors';
import type { HttpClient } from './HttpClient';
import { InfoWinRestApi } from './InfoWinRestApi';

export type DetectionStatus = 'ok' | 'auth' | 'connection' | 'timeout' | 'unsupported' | 'malformed' | 'error';

export interface DetectionResult {
    status: DetectionStatus;
    family: string | null;
    controller: ControllerInfo | null;
    message: string;
    api?: WritableControllerApi;
}

/**
 * Identify the API family using non-mutating GET probes only. Currently one family is known
 * ({@link InfoWinRestApi}); the structure allows adding families without touching callers.
 * Distinguishes authentication, connection, timeout and unsupported-firmware failures.
 *
 * @param http Configured client
 */
export async function detectProtocol(http: HttpClient): Promise<DetectionResult> {
    const api = new InfoWinRestApi(http);
    try {
        // Module list is the authoritative probe: the same call drives discovery.
        const modules = await api.listModules();
        let controller: ControllerInfo = { device: null, version: null };
        try {
            controller = await api.getControllerInfo();
        } catch (err) {
            // deviceinfo is optional; absence is not a failure as long as the module list works.
            if (
                err instanceof WindhagerError &&
                (err.kind === 'auth' || err.kind === 'connection' || err.kind === 'timeout')
            ) {
                throw err;
            }
        }
        return {
            status: 'ok',
            family: api.family,
            controller,
            message: `Detected ${api.family} with ${modules.length} module(s)`,
            api,
        };
    } catch (err) {
        if (err instanceof WindhagerError) {
            const status: DetectionStatus = err.kind === 'http' || err.kind === 'validation' ? 'error' : err.kind;
            return { status, family: null, controller: null, message: err.message };
        }
        return {
            status: 'error',
            family: null,
            controller: null,
            message: err instanceof Error ? err.message : String(err),
        };
    }
}
