/** Base class; `kind` lets callers branch without instanceof checks across module boundaries. */
export class WindhagerError extends Error {
    public constructor(
        public readonly kind: 'auth' | 'connection' | 'timeout' | 'unsupported' | 'malformed' | 'http' | 'validation',
        message: string,
        public readonly status?: number,
    ) {
        super(message);
        this.name = 'WindhagerError';
    }
}

export const authError = (message = 'Authentication failed (HTTP 401)'): WindhagerError =>
    new WindhagerError('auth', message, 401);
export const connectionError = (message: string): WindhagerError => new WindhagerError('connection', message);
export const timeoutError = (ms: number): WindhagerError =>
    new WindhagerError('timeout', `Request timed out after ${ms} ms`);
export const unsupportedError = (message: string, status?: number): WindhagerError =>
    new WindhagerError('unsupported', message, status);
export const malformedError = (message: string): WindhagerError => new WindhagerError('malformed', message);
export const httpError = (status: number, message?: string): WindhagerError =>
    new WindhagerError('http', message ?? `HTTP ${status}`, status);
export const validationError = (message: string): WindhagerError => new WindhagerError('validation', message);

/**
 * Whether a failed GET is worth retrying. Authentication, unsupported and malformed responses are not.
 *
 * @param err Error thrown by the transport
 */
export function isRetryable(err: unknown): boolean {
    if (!(err instanceof WindhagerError)) {
        return false;
    }
    if (err.kind === 'connection' || err.kind === 'timeout') {
        return true;
    }
    return err.kind === 'http' && (err.status ?? 0) >= 500;
}
