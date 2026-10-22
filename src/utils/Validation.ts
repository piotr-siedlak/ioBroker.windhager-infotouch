/** Raw adapter configuration as stored by ioBroker (types are not guaranteed). */
export interface AdapterConfig {
    host: string;
    protocol: 'http' | 'https';
    port: number;
    username: string;
    password: string;
    verifyTls: boolean;
    timeoutMs: number;
    maxConcurrency: number;
    pollFastSec: number;
    pollNormalSec: number;
    pollSlowSec: number;
    enableFast: boolean;
    enableNormal: boolean;
    enableSlow: boolean;
    pollLon: boolean;
    fastGroups: string;
    excludedNodes: string;
    exposeRaw: boolean;
    cacheMaxAgeHours: number;
    writesEnabled: boolean;
    writeAllowlist: string;
    verifyWrites: boolean;
    /** Language of names taken from the controller (`''` = ioBroker system language). */
    language: string;
}

export interface NormalizedConfig extends Omit<AdapterConfig, 'fastGroups' | 'excludedNodes' | 'writeAllowlist'> {
    fastGroups: Set<string>;
    excludedNodes: Set<number>;
    writeAllowlist: Set<string>;
}

export const DEFAULT_CONFIG: AdapterConfig = {
    host: '',
    protocol: 'http',
    port: 80,
    username: 'USER',
    password: '',
    verifyTls: true,
    timeoutMs: 15000,
    maxConcurrency: 2,
    pollFastSec: 30,
    pollNormalSec: 60,
    pollSlowSec: 300,
    enableFast: true,
    enableNormal: true,
    enableSlow: true,
    pollLon: false,
    fastGroups: '',
    excludedNodes: '',
    exposeRaw: false,
    cacheMaxAgeHours: 168,
    writesEnabled: false,
    writeAllowlist: '',
    verifyWrites: true,
    language: '',
};

const clamp = (value: unknown, min: number, max: number, fallback: number): number => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
};

const splitList = (value: unknown): string[] =>
    typeof value === 'string'
        ? value
              .split(/[\s,;]+/)
              .map(s => s.trim())
              .filter(Boolean)
        : [];

/** Host may be an IPv4/IPv6 literal or hostname; reject anything with a scheme, path or whitespace. */
export function isValidHost(host: string): boolean {
    return /^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/.test(host) || /^[0-9a-fA-F:]+$/.test(host);
}

export const OID_PATTERN = /^\/1\/\d+\/\d+\/\d+\/\d+\/\d+$/;

/**
 * Validate and normalise raw config. Never throws; collects human-readable problems instead.
 *
 * @param raw Config object from ioBroker
 */
export function normalizeConfig(raw: Partial<AdapterConfig> | undefined): {
    config: NormalizedConfig;
    problems: string[];
} {
    const c = { ...DEFAULT_CONFIG, ...(raw ?? {}) };
    const problems: string[] = [];

    const host = String(c.host ?? '').trim();
    if (!host) {
        problems.push('Host is not configured');
    } else if (!isValidHost(host)) {
        problems.push('Host must be a plain IP address or hostname (no scheme or path)');
    }

    const writeAllowlist = new Set<string>();
    for (const oid of splitList(c.writeAllowlist)) {
        if (OID_PATTERN.test(oid)) {
            writeAllowlist.add(oid);
        } else {
            problems.push(`Ignoring invalid OID in write allow-list: ${oid}`);
        }
    }
    const excludedNodes = new Set<number>();
    for (const n of splitList(c.excludedNodes)) {
        if (/^\d+$/.test(n)) {
            excludedNodes.add(Number(n));
        } else {
            problems.push(`Ignoring invalid node id: ${n}`);
        }
    }

    const protocol = c.protocol === 'https' ? 'https' : 'http';
    const config: NormalizedConfig = {
        host,
        protocol,
        port: clamp(c.port, 1, 65535, protocol === 'https' ? 443 : 80),
        username: String(c.username ?? ''),
        password: String(c.password ?? ''),
        // Only an explicit `false` disables certificate verification.
        verifyTls: c.verifyTls !== false,
        timeoutMs: clamp(c.timeoutMs, 1000, 120000, 15000),
        maxConcurrency: clamp(c.maxConcurrency, 1, 4, 2),
        pollFastSec: clamp(c.pollFastSec, 10, 3600, 30),
        pollNormalSec: clamp(c.pollNormalSec, 30, 7200, 60),
        pollSlowSec: clamp(c.pollSlowSec, 60, 86400, 300),
        enableFast: c.enableFast !== false,
        enableNormal: c.enableNormal !== false,
        enableSlow: c.enableSlow !== false,
        pollLon: c.pollLon === true,
        fastGroups: new Set(splitList(c.fastGroups)),
        excludedNodes,
        exposeRaw: c.exposeRaw === true,
        cacheMaxAgeHours: clamp(c.cacheMaxAgeHours, 1, 24 * 90, 168),
        // Writes need an explicit opt-in; anything other than boolean true means disabled.
        writesEnabled: c.writesEnabled === true,
        writeAllowlist,
        verifyWrites: c.verifyWrites !== false,
        language: typeof c.language === 'string' && /^[a-z]{2}$/.test(c.language) ? c.language : '',
    };
    return { config, problems };
}
