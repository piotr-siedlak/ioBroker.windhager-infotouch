"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HttpClient = exports.DEFAULT_HTTP_OPTIONS = void 0;
const node_http_1 = __importDefault(require("node:http"));
const node_https_1 = __importDefault(require("node:https"));
const DigestAuth_1 = require("./DigestAuth");
const errors_1 = require("./errors");
const MAX_BODY_BYTES = 4 * 1024 * 1024;
exports.DEFAULT_HTTP_OPTIONS = {
    port: 80,
    protocol: 'http',
    timeoutMs: 15000,
    maxConcurrency: 2,
    retries: 2,
    backoffBaseMs: 500,
    backoffMaxMs: 8000,
    verifyTls: true,
};
/**
 * Minimal HTTP client with Digest authentication, bounded concurrency, timeouts and GET retries.
 * It never logs credentials or authorization headers.
 */
class HttpClient {
    options;
    agent;
    challenge = null;
    nc = 0;
    active = 0;
    waiting = [];
    closed = false;
    onMetric;
    /** Injectable for tests so backoff does not slow them down. */
    sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    constructor(options) {
        this.options = options;
        const agentOptions = { keepAlive: true, maxSockets: Math.max(1, options.maxConcurrency) };
        this.agent =
            options.protocol === 'https'
                ? new node_https_1.default.Agent({ ...agentOptions, rejectUnauthorized: options.verifyTls })
                : new node_http_1.default.Agent(agentOptions);
    }
    close() {
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
    async getJson(path, query) {
        let attempt = 0;
        for (;;) {
            try {
                return await this.limited(() => this.request('GET', path, query));
            }
            catch (err) {
                if (this.closed || attempt >= this.options.retries || !(0, errors_1.isRetryable)(err)) {
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
    async putJson(path, body, query) {
        return this.limited(() => this.request('PUT', path, query, JSON.stringify(body)));
    }
    async limited(fn) {
        // Re-check after every wake-up: a newly arrived request may have taken the freed slot first.
        while (this.active >= this.options.maxConcurrency && !this.closed) {
            await new Promise(resolve => this.waiting.push(resolve));
        }
        if (this.closed) {
            throw (0, errors_1.connectionError)('Client closed');
        }
        this.active++;
        try {
            return await fn();
        }
        finally {
            this.active--;
            this.waiting.shift()?.();
        }
    }
    buildUri(path, query) {
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
    async request(method, path, query, body) {
        const started = Date.now();
        const uri = this.buildUri(path, query);
        try {
            let res = await this.once(method, uri, body, true);
            if (res.status === 401) {
                const challenge = (0, DigestAuth_1.parseChallenge)(res.headers['www-authenticate']);
                if (!challenge) {
                    throw (0, errors_1.unsupportedError)('HTTP 401 without a Digest challenge', 401);
                }
                this.challenge = challenge;
                this.nc = 0;
                res = await this.once(method, uri, body, true);
                if (res.status === 401) {
                    throw (0, errors_1.authError)();
                }
            }
            this.onMetric?.({ method, path, status: res.status, durationMs: Date.now() - started });
            return this.parse(res.status, res.body);
        }
        catch (err) {
            this.onMetric?.({
                method,
                path,
                durationMs: Date.now() - started,
                error: err instanceof Error ? err.message : String(err),
            });
            throw err;
        }
    }
    parse(status, text) {
        if (status === 404) {
            throw (0, errors_1.unsupportedError)(`HTTP 404`, 404);
        }
        if (status < 200 || status >= 300) {
            throw (0, errors_1.httpError)(status);
        }
        if (text.trim() === '') {
            return null;
        }
        try {
            return JSON.parse(text);
        }
        catch {
            throw (0, errors_1.malformedError)('Response is not valid JSON');
        }
    }
    once(method, uri, body, allowAuth) {
        return new Promise((resolve, reject) => {
            const headers = { Accept: 'application/json' };
            if (body !== undefined) {
                headers['Content-Type'] = 'application/json';
                headers['Content-Length'] = Buffer.byteLength(body);
            }
            if (allowAuth && this.challenge) {
                this.nc++;
                try {
                    headers.Authorization = (0, DigestAuth_1.buildAuthorization)({
                        method,
                        uri,
                        username: this.options.username,
                        password: this.options.password,
                        challenge: this.challenge,
                        nc: this.nc,
                    });
                }
                catch (err) {
                    reject((0, errors_1.unsupportedError)(err instanceof Error ? err.message : String(err)));
                    return;
                }
            }
            const lib = this.options.protocol === 'https' ? node_https_1.default : node_http_1.default;
            const req = lib.request({
                host: this.options.host,
                port: this.options.port,
                method,
                path: uri,
                headers,
                agent: this.agent,
                timeout: this.options.timeoutMs,
            }, res => {
                const chunks = [];
                let size = 0;
                res.on('data', (chunk) => {
                    size += chunk.length;
                    if (size > MAX_BODY_BYTES) {
                        req.destroy((0, errors_1.malformedError)('Response too large'));
                        return;
                    }
                    chunks.push(chunk);
                });
                res.on('end', () => resolve({
                    status: res.statusCode ?? 0,
                    headers: res.headers,
                    body: Buffer.concat(chunks).toString('utf8'),
                }));
                res.on('error', e => reject((0, errors_1.connectionError)(e.message)));
            });
            // `timeout` above only fires on an idle socket; this bounds the whole exchange (slow-drip responses).
            const deadline = setTimeout(() => req.destroy((0, errors_1.timeoutError)(this.options.timeoutMs)), this.options.timeoutMs);
            req.on('close', () => clearTimeout(deadline));
            req.on('timeout', () => req.destroy((0, errors_1.timeoutError)(this.options.timeoutMs)));
            req.on('error', e => {
                if (e instanceof Error && 'kind' in e) {
                    reject(e);
                }
                else {
                    reject((0, errors_1.connectionError)(e.message));
                }
            });
            if (body !== undefined) {
                req.write(body);
            }
            req.end();
        });
    }
}
exports.HttpClient = HttpClient;
