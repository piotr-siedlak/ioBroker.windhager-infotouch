"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validationError = exports.httpError = exports.malformedError = exports.unsupportedError = exports.timeoutError = exports.connectionError = exports.authError = exports.WindhagerError = void 0;
exports.isRetryable = isRetryable;
/** Base class; `kind` lets callers branch without instanceof checks across module boundaries. */
class WindhagerError extends Error {
    kind;
    status;
    constructor(kind, message, status) {
        super(message);
        this.kind = kind;
        this.status = status;
        this.name = 'WindhagerError';
    }
}
exports.WindhagerError = WindhagerError;
const authError = (message = 'Authentication failed (HTTP 401)') => new WindhagerError('auth', message, 401);
exports.authError = authError;
const connectionError = (message) => new WindhagerError('connection', message);
exports.connectionError = connectionError;
const timeoutError = (ms) => new WindhagerError('timeout', `Request timed out after ${ms} ms`);
exports.timeoutError = timeoutError;
const unsupportedError = (message, status) => new WindhagerError('unsupported', message, status);
exports.unsupportedError = unsupportedError;
const malformedError = (message) => new WindhagerError('malformed', message);
exports.malformedError = malformedError;
const httpError = (status, message) => new WindhagerError('http', message ?? `HTTP ${status}`, status);
exports.httpError = httpError;
const validationError = (message) => new WindhagerError('validation', message);
exports.validationError = validationError;
/**
 * Whether a failed GET is worth retrying. Authentication, unsupported and malformed responses are not.
 *
 * @param err Error thrown by the transport
 */
function isRetryable(err) {
    if (!(err instanceof WindhagerError)) {
        return false;
    }
    if (err.kind === 'connection' || err.kind === 'timeout') {
        return true;
    }
    return err.kind === 'http' && (err.status ?? 0) >= 500;
}
