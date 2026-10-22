import { createHash, randomBytes } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo, Socket } from 'node:net';

export type Json = Record<string, unknown> | unknown[];

export interface FakeBehaviour {
    /** Respond to everything with this status (after auth), e.g. 404 for an unsupported API. */
    forceStatus?: number;
    /** 200 with an HTML landing page instead of JSON (newer comWinStack firmware). */
    htmlLanding?: boolean;
    /** 200 with invalid JSON. */
    malformed?: boolean;
    /** Never answer. */
    hang?: boolean;
    /** Fail this many requests with 500 first. */
    failFirst?: number;
    /** Writes are acknowledged but the stored value does not change. */
    ignoreWrites?: boolean;
    /** Writes are answered with this status and not applied. */
    rejectWritesWith?: number;
    /** Add latency to every answer. */
    delayMs?: number;
    /** Writes become visible only after this many further lookup reads (slow apply). */
    applyAfterReads?: number;
    /** Send the body this slowly (one byte per interval, ms) to defeat idle timeouts. */
    dripMs?: number;
}

export interface Fixture {
    deviceinfo: Json;
    /** Path below /api/1.0/lookup (e.g. `/1/15/0/3`) -> payload. Numbers produce a status code. */
    lookups: Record<string, Json | number>;
    /** Paged payloads by lookup path, indexed by `offset`. */
    paged?: Record<string, Record<number, Json>>;
    /** Objects by full OID for /api/1.0/object. */
    objects?: Record<string, Json | number>;
    /** Static resources by path, e.g. `/res/xml/VarIdentTexte_en.xml`. */
    resources?: Record<string, string | Buffer>;
}

const md5 = (s: string): string => createHash('md5').update(s).digest('hex');

/**
 * In-process fake of the controller HTTP API. It verifies Digest responses with its own implementation
 * (independent of src/api/DigestAuth.ts) so a bug in the client cannot cancel out in the test.
 */
export class FakeController {
    public readonly requests: Array<{ method: string; url: string; authorized: boolean; body?: string }> = [];
    public maxConcurrent = 0;
    public behaviour: FakeBehaviour = {};
    /** OID -> current value; PUT /api/1.0/datapoint mutates it and lookup responses reflect it. */
    public values = new Map<string, string>();
    public challenges = 0;
    private pending: { oid: string; value: string; reads: number } | null = null;
    private server: http.Server | null = null;
    private active = 0;
    private nonce = randomBytes(8).toString('hex');
    private failures = 0;
    private readonly sockets = new Set<Socket>();

    public constructor(
        public fixture: Fixture,
        private readonly credentials = { username: 'USER', password: 'secret-pw' },
        private readonly realm = 'MesInfinity',
    ) {}

    private lastPort = 0;

    public get port(): number {
        const address = this.server?.address() as AddressInfo | null | undefined;
        return address?.port ?? this.lastPort;
    }

    public async start(): Promise<void> {
        this.server = http.createServer((req, res) => void this.handle(req, res));
        this.server.on('connection', s => {
            this.sockets.add(s);
            s.on('close', () => this.sockets.delete(s));
        });
        await new Promise<void>(resolve => this.server!.listen(0, '127.0.0.1', resolve));
        this.lastPort = (this.server.address() as AddressInfo).port;
    }

    public async stop(): Promise<void> {
        for (const s of this.sockets) {
            s.destroy();
        }
        await new Promise<void>(resolve => (this.server ? this.server.close(() => resolve()) : resolve()));
    }

    private authorized(req: http.IncomingMessage): boolean {
        const header = req.headers.authorization;
        if (!header?.startsWith('Digest ')) {
            return false;
        }
        const f: Record<string, string> = {};
        for (const m of header.slice(7).matchAll(/(\w+)=(?:"([^"]*)"|([^,\s]*))/g)) {
            f[m[1]] = m[2] ?? m[3];
        }
        if (f.username !== this.credentials.username || f.nonce !== this.nonce || f.realm !== this.realm) {
            return false;
        }
        if (f.uri !== req.url) {
            return false;
        }
        const ha1 = md5(`${f.username}:${this.realm}:${this.credentials.password}`);
        const ha2 = md5(`${req.method}:${f.uri}`);
        const expected = md5(`${ha1}:${f.nonce}:${f.nc}:${f.cnonce}:${f.qop}:${ha2}`);
        return expected === f.response;
    }

    private send(res: http.ServerResponse, status: number, body: string, type = 'application/json'): void {
        res.writeHead(status, { 'Content-Type': type });
        const drip = this.behaviour.dripMs;
        if (!drip) {
            res.end(body);
            return;
        }
        let i = 0;
        const timer = setInterval(() => {
            if (i >= body.length || res.destroyed) {
                clearInterval(timer);
                res.end();
                return;
            }
            res.write(body[i++]);
        }, drip);
        res.on('close', () => clearInterval(timer));
    }

    private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        this.active++;
        this.maxConcurrent = Math.max(this.maxConcurrent, this.active);
        res.on('close', () => this.active--);

        const chunks: Buffer[] = [];
        for await (const c of req) {
            chunks.push(c as Buffer);
        }
        const body = chunks.length ? Buffer.concat(chunks).toString('utf8') : undefined;
        const ok = this.authorized(req);
        this.requests.push({ method: req.method ?? '', url: req.url ?? '', authorized: ok, body });

        if (this.behaviour.hang) {
            return; // never answers
        }
        if (!ok) {
            this.challenges++;
            res.writeHead(401, {
                'WWW-Authenticate': `Digest realm="${this.realm}", nonce="${this.nonce}", qop="auth", algorithm=MD5`,
            });
            res.end();
            return;
        }
        if (this.behaviour.delayMs) {
            await new Promise(r => setTimeout(r, this.behaviour.delayMs));
        }
        if (this.behaviour.failFirst && this.failures < this.behaviour.failFirst) {
            this.failures++;
            this.send(res, 500, '{}');
            return;
        }
        if (this.behaviour.forceStatus) {
            this.send(res, this.behaviour.forceStatus, '{}');
            return;
        }
        if (this.behaviour.htmlLanding) {
            this.send(res, 200, '<html><body>comWinStack API</body></html>', 'text/html');
            return;
        }
        if (this.behaviour.malformed) {
            this.send(res, 200, '{not json');
            return;
        }
        this.route(req, res, body);
    }

    private applyValues(payload: Json): Json {
        const patch = (item: unknown): unknown => {
            if (item && typeof item === 'object' && 'OID' in item) {
                const rec = item as Record<string, unknown>;
                const v = this.values.get(String(rec.OID));
                return v !== undefined ? { ...rec, value: v } : rec;
            }
            return item;
        };
        return Array.isArray(payload) ? payload.map(patch) : (patch(payload) as Json);
    }

    private route(req: http.IncomingMessage, res: http.ServerResponse, body?: string): void {
        const url = new URL(req.url ?? '/', 'http://x');
        const path = url.pathname;
        if (req.method === 'GET' && path.startsWith('/res/')) {
            const resource = this.fixture.resources?.[path];
            if (resource === undefined) {
                this.send(res, 404, '');
            } else {
                res.writeHead(200, { 'Content-Type': 'application/xml' });
                res.end(resource);
            }
            return;
        }
        if (req.method === 'GET' && path === '/api/1.0/info/deviceinfo') {
            this.send(res, 200, JSON.stringify(this.fixture.deviceinfo));
            return;
        }
        if (req.method === 'GET' && path.startsWith('/api/1.0/lookup')) {
            if (this.pending && --this.pending.reads < 0) {
                this.values.set(this.pending.oid, this.pending.value);
                this.pending = null;
            }
            const key = path.slice('/api/1.0/lookup'.length);
            const offset = url.searchParams.get('offset');
            const paged = this.fixture.paged?.[key];
            if (paged && offset !== null) {
                const page = paged[Number(offset)];
                this.send(res, page ? 200 : 404, JSON.stringify(page ? this.applyValues(page) : {}));
                return;
            }
            const entry = this.fixture.lookups[key];
            if (typeof entry === 'number') {
                this.send(res, entry, '{}');
            } else if (entry === undefined) {
                // Single-OID reads fall back to whichever group entry matches.
                const found = this.findByOid(key);
                this.send(res, found ? 200 : 404, JSON.stringify(found ? this.applyValues(found) : {}));
            } else {
                this.send(res, 200, JSON.stringify(this.applyValues(entry)));
            }
            return;
        }
        if (req.method === 'GET' && path === '/api/1.0/object') {
            const entry = this.fixture.objects?.[url.searchParams.get('OID') ?? ''];
            if (typeof entry === 'number') {
                this.send(res, entry, '{}');
            } else {
                this.send(res, entry ? 200 : 404, JSON.stringify(entry ?? {}));
            }
            return;
        }
        if (req.method === 'PUT' && path === '/api/1.0/datapoint') {
            const parsed = JSON.parse(body ?? '{}') as { OID?: string; value?: unknown };
            if (this.behaviour.rejectWritesWith) {
                this.send(res, this.behaviour.rejectWritesWith, '{}');
                return;
            }
            if (typeof parsed.OID !== 'string' || typeof parsed.value !== 'string') {
                this.send(res, 400, '{}');
                return;
            }
            if (this.behaviour.applyAfterReads) {
                this.pending = { oid: parsed.OID, value: parsed.value, reads: this.behaviour.applyAfterReads };
            } else if (!this.behaviour.ignoreWrites) {
                this.values.set(parsed.OID, parsed.value);
            }
            this.send(res, 200, '{}');
            return;
        }
        this.send(res, 404, '{}');
    }

    private findByOid(oid: string): Json | undefined {
        for (const payload of Object.values(this.fixture.lookups)) {
            if (Array.isArray(payload)) {
                const hit = payload.find(i => i && typeof i === 'object' && (i as Record<string, unknown>).OID === oid);
                if (hit) {
                    return [hit];
                }
            }
        }
        return undefined;
    }
}
