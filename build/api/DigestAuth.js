"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseChallenge = parseChallenge;
exports.buildAuthorization = buildAuthorization;
const node_crypto_1 = require("node:crypto");
const md5 = (value) => (0, node_crypto_1.createHash)('md5').update(value).digest('hex');
/**
 * Parse a Digest challenge header. Returns null when the header is not a usable Digest challenge.
 *
 * @param header Raw value of the `WWW-Authenticate` header
 */
function parseChallenge(header) {
    if (!header || !/^\s*digest\s/i.test(header)) {
        return null;
    }
    const fields = {};
    const re = /([a-z0-9_-]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s,]*))/gi;
    let match;
    while ((match = re.exec(header.replace(/^\s*digest\s+/i, ''))) !== null) {
        fields[match[1].toLowerCase()] = (match[2] ?? match[3] ?? '').replace(/\\(.)/g, '$1');
    }
    if (!fields.realm || !fields.nonce) {
        return null;
    }
    // "auth-int" needs the body hash; the controller is only known to use "auth", so we pick that if offered.
    const qopOptions = fields.qop?.split(',').map(q => q.trim());
    const qop = qopOptions ? (qopOptions.includes('auth') ? 'auth' : qopOptions[0]) : undefined;
    return {
        realm: fields.realm,
        nonce: fields.nonce,
        opaque: fields.opaque,
        algorithm: (fields.algorithm ?? 'MD5').toUpperCase(),
        qop,
    };
}
/**
 * Build the `Authorization` header value (RFC 2617 / 7616, MD5 and MD5-sess).
 *
 * @param params Request and credential data
 */
function buildAuthorization(params) {
    const { method, uri, username, password, challenge, nc } = params;
    if (challenge.algorithm !== 'MD5' && challenge.algorithm !== 'MD5-SESS') {
        throw new Error(`Unsupported digest algorithm: ${challenge.algorithm}`);
    }
    if (challenge.qop === 'auth-int') {
        throw new Error('Unsupported digest qop: auth-int');
    }
    const cnonce = params.cnonce ?? (0, node_crypto_1.randomBytes)(8).toString('hex');
    const ncHex = nc.toString(16).padStart(8, '0');
    let ha1 = md5(`${username}:${challenge.realm}:${password}`);
    if (challenge.algorithm === 'MD5-SESS') {
        ha1 = md5(`${ha1}:${challenge.nonce}:${cnonce}`);
    }
    const ha2 = md5(`${method.toUpperCase()}:${uri}`);
    const response = challenge.qop
        ? md5(`${ha1}:${challenge.nonce}:${ncHex}:${cnonce}:${challenge.qop}:${ha2}`)
        : md5(`${ha1}:${challenge.nonce}:${ha2}`);
    const parts = [
        `username="${username.replace(/(["\\])/g, '\\$1')}"`,
        `realm="${challenge.realm}"`,
        `nonce="${challenge.nonce}"`,
        `uri="${uri}"`,
        `algorithm=${challenge.algorithm}`,
        `response="${response}"`,
    ];
    if (challenge.qop) {
        parts.push(`qop=${challenge.qop}`, `nc=${ncHex}`, `cnonce="${cnonce}"`);
    }
    if (challenge.opaque) {
        parts.push(`opaque="${challenge.opaque}"`);
    }
    return `Digest ${parts.join(', ')}`;
}
