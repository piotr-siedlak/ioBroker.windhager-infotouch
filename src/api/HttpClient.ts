import http from 'node:http';
import https from 'node:https';
import { buildAuthorization, parseChallenge, type DigestChallenge } from './DigestAuth';
import {
    authError,
    connectionError,
    httpError,
    isRetryable,
    malformedError,
    timeoutError,
    unsupportedError,
} from './errors';

export interface HttpClientOptions {
    host: string;
    port: number;
    protocol: 'http' | 'https';
    username: string;
    password: string;
    timeoutMs: number;
    /** Controller answers requests sequentially, so keep this low. */
    maxConcurrency: number;
    /** Extra attempts for idempotent GET requests only. */
    retries: number;
    backoffBaseMs: number;
    backoffMaxMs: number;
    /** TLS certificate verification. Defaults to true and must be disabled explicitly. */
    verifyTls: boolean;
}

export interface RequestMetric {
    method: string;
    path: string;
    status?: number;
    durationMs: number;
    error?: string;
}

const MAX_BODY_BYTES = 4 * 1024 * 1024;

export const DEFAULT_HTTP_OPTIONS = {
    port: 80,
    protocol: 'http',
    timeoutMs: 15000,
    maxConcurrency: 2,
    retries: 2,
    backoffBaseMs: 500,
    backoffMaxMs: 8000,
    verifyTls: true,
} as const;

type Query = Record<string, string | number>;

/**
 * Minimal HTTP client with Digest authentication, bounded concurrency, timeouts and GET retries.
 * It never logs credentials or authorization headers.
 */
export class HttpClient {
    private readonly agent: http.Agent;
    private challenge: DigestChallenge | null = null;
    private nc = 0;
    private active = 0;
    private readonly waiting: Array<() => void> = [];
    private closed = false;

    public onMetric?: (metric: RequestMetric) => void;
    /** Injectable for tests so backoff does not slow them down. */
    public sleep: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms));

    public constructor(private readonly options: HttpClientOptions) {
        const agentOptions = { keepAlive: true, maxSockets: Math.max(1, options.maxConcurrency) };
        this.agent =
            options.protocol === 'https'
                ? new https.Agent({ ...agentOptions, rejectUnauthorized: options.verifyTls })
                : new http.Agent(agentOptions);
    }

    public close(): void {
        this.closed = true;
        this.agent.destroy();
        // Release anything still queued so callers do not hang during shutdown.
        for (const release of this.waiting.splice(0)) {
            release();
        }
    }

    /**
     * GET and parse JSON.
     *
     * @param path Absolute request path
     * @param query Optional query parameters
     */
    public async getJson(path: string, query?: Query): Promise<unknown> {
        return this.getWithRetry(() => this.request('GET', path, query));
    }

    /**
     * GET raw bytes (e.g. XML resources whose charset is declared inside the document).
     *
     * @param path Absolute request path
     */
    public async getBytes(path: string): Promise<Buffer> {
        return this.getWithRetry(() => this.request('GET', path, undefined, undefined, true) as Promise<Buffer>);
    }

    private async getWithRetry<T>(fn: () => Promise<T>): Promise<T> {
        let attempt = 0;
        for (;;) {
            try {
                return await this.limited(fn);
            } catch (err) {
                if (this.closed || attempt >= this.options.retries || !isRetryable(err)) {
                    throw err;
                }
                const delay = Math.min(this.options.backoffMaxMs, this.options.backoffBaseMs * 2 ** attempt);
                attempt++;
                await this.sleep(delay);
            }
        }
    }

    /**
     * PUT a JSON body. Never retried automatically, because a repeated write is not guaranteed to be harmless.
     *
     * @param path Absolute request path
     * @param body JSON-serialisable payload
     * @param query Optional query parameters
     */
    public async putJson(path: string, body: unknown, query?: Query): Promise<unknown> {
        return this.limited(() => this.request('PUT', path, query, JSON.stringify(body)));
    }

    private async limited<T>(fn: () => Promise<T>): Promise<T> {
        // Re-check after every wake-up: a newly arrived request may have taken the freed slot first.
        while (this.active >= this.options.maxConcurrency && !this.closed) {
            await new Promise<void>(resolve => this.waiting.push(resolve));
        }
        if (this.closed) {
            throw connectionError('Client closed');
        }
        this.active++;
        try {
            return await fn();
        } finally {
            this.active--;
            this.waiting.shift()?.();
        }
    }

    private buildUri(path: string, query?: Query): string {
        if (!path.startsWith('/')) {
            throw new Error('Request path must be absolute');
        }
        if (!query || Object.keys(query).length === 0) {
            return path;
        }
        const qs = Object.entries(query)
            .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
            .join('&');
        return `${path}?${qs}`;
    }

    private async request(method: string, path: string, query?: Query, body?: string, raw = false): Promise<unknown> {
        const started = Date.now();
        const uri = this.buildUri(path, query);
        try {
            let res = await this.once(method, uri, body, true);
            if (res.status === 401) {
                const challenge = parseChallenge(res.headers['www-authenticate']);
                if (!challenge) {
                    throw unsupportedError('HTTP 401 without a Digest challenge', 401);
                }
                this.challenge = challenge;
                this.nc = 0;
                res = await this.once(method, uri, body, true);
                if (res.status === 401) {
                    throw authError();
                }
            }
            this.onMetric?.({ method, path, status: res.status, durationMs: Date.now() - started });
            return raw ? this.checkRaw(res.status, res.body) : this.parse(res.status, res.body.toString('utf8'));
        } catch (err) {
            this.onMetric?.({
                method,
                path,
                durationMs: Date.now() - started,
                error: err instanceof Error ? err.message : String(err),
            });
            throw err;
        }
    }

    private checkRaw(status: number, body: Buffer): Buffer {
        if (status === 404) {
            throw unsupportedError('HTTP 404', 404);
        }
        if (status < 200 || status >= 300) {
            throw httpError(status);
        }
        return body;
    }

    private parse(status: number, text: string): unknown {
        if (status === 404) {
            throw unsupportedError(`HTTP 404`, 404);
        }
        if (status < 200 || status >= 300) {
            throw httpError(status);
        }
        if (text.trim() === '') {
            return null;
        }
        try {
            return JSON.parse(text);
        } catch {
            throw malformedError('Response is not valid JSON');
        }
    }

    private once(
        method: string,
        uri: string,
        body: string | undefined,
        allowAuth: boolean,
    ): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
        return new Promise((resolve, reject) => {
            const headers: Record<string, string | number> = { Accept: 'application/json' };
            if (body !== undefined) {
                headers['Content-Type'] = 'application/json';
                headers['Content-Length'] = Buffer.byteLength(body);
            }
            if (allowAuth && this.challenge) {
                this.nc++;
                try {
                    headers.Authorization = buildAuthorization({
                        method,
                        uri,
                        username: this.options.username,
                        password: this.options.password,
                        challenge: this.challenge,
                        nc: this.nc,
                    });
                } catch (err) {
                    reject(unsupportedError(err instanceof Error ? err.message : String(err)));
                    return;
                }
            }
            const lib = this.options.protocol === 'https' ? https : http;
            const req = lib.request(
                {
                    host: this.options.host,
                    port: this.options.port,
                    method,
                    path: uri,
                    headers,
                    agent: this.agent,
                    timeout: this.options.timeoutMs,
                },
                res => {
                    const chunks: Buffer[] = [];
                    let size = 0;
                    res.on('data', (chunk: Buffer) => {
                        size += chunk.length;
                        if (size > MAX_BODY_BYTES) {
                            req.destroy(malformedError('Response too large'));
                            return;
                        }
                        chunks.push(chunk);
                    });
                    res.on('end', () =>
                        resolve({
                            status: res.statusCode ?? 0,
                            headers: res.headers,
                            body: Buffer.concat(chunks),
                        }),
                    );
                    res.on('error', e => reject(connectionError(e.message)));
                },
            );
            // `timeout` above only fires on an idle socket; this bounds the whole exchange (slow-drip responses).
            const deadline = setTimeout(
                () => req.destroy(timeoutError(this.options.timeoutMs)),
                this.options.timeoutMs,
            );
            req.on('close', () => clearTimeout(deadline));
            req.on('timeout', () => req.destroy(timeoutError(this.options.timeoutMs)));
            req.on('error', e => {
                if (e instanceof Error && 'kind' in e) {
                    reject(e);
                } else {
                    reject(connectionError(e.message));
                }
            });
            if (body !== undefined) {
                req.write(body);
            }
            req.end();
        });
    }
}
