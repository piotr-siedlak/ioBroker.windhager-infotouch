"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectProtocol = detectProtocol;
const errors_1 = require("./errors");
const InfoWinRestApi_1 = require("./InfoWinRestApi");
/**
 * Identify the API family using non-mutating GET probes only. Currently one family is known
 * ({@link InfoWinRestApi}); the structure allows adding families without touching callers.
 * Distinguishes authentication, connection, timeout and unsupported-firmware failures.
 *
 * @param http Configured client
 */
async function detectProtocol(http) {
    const api = new InfoWinRestApi_1.InfoWinRestApi(http);
    try {
        // Module list is the authoritative probe: the same call drives discovery.
        const modules = await api.listModules();
        let controller = { device: null, version: null };
        try {
            controller = await api.getControllerInfo();
        }
        catch (err) {
            // deviceinfo is optional; absence is not a failure as long as the module list works.
            if (err instanceof errors_1.WindhagerError &&
                (err.kind === 'auth' || err.kind === 'connection' || err.kind === 'timeout')) {
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
    }
    catch (err) {
        if (err instanceof errors_1.WindhagerError) {
            const status = err.kind === 'http' || err.kind === 'validation' ? 'error' : err.kind;
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
