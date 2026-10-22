import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildAuthorization, parseChallenge } from '../src/api/DigestAuth';

describe('DigestAuth', () => {
    // RFC 2617 section 3.5 worked example
    const header =
        'Digest realm="testrealm@host.com", qop="auth,auth-int", nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093", opaque="5ccc069c403ebaf9f0171e9517f40e41"';

    it('parses a challenge and prefers qop=auth', () => {
        const c = parseChallenge(header);
        assert.equal(c?.realm, 'testrealm@host.com');
        assert.equal(c?.qop, 'auth');
        assert.equal(c?.algorithm, 'MD5');
    });

    it('reproduces the RFC 2617 response value', () => {
        const challenge = parseChallenge(header)!;
        const auth = buildAuthorization({
            method: 'GET',
            uri: '/dir/index.html',
            username: 'Mufasa',
            password: 'Circle Of Life',
            challenge,
            nc: 1,
            cnonce: '0a4f113b',
        });
        assert.match(auth, /response="6629fae49393a05397450978507c4ef1"/);
        assert.match(auth, /nc=00000001/);
    });

    it('rejects non-digest and incomplete challenges', () => {
        assert.equal(parseChallenge('Basic realm="x"'), null);
        assert.equal(parseChallenge(undefined), null);
        assert.equal(parseChallenge('Digest realm="x"'), null);
    });

    it('refuses unsupported algorithms instead of silently downgrading', () => {
        const challenge = { ...parseChallenge(header)!, algorithm: 'SHA-256' };
        assert.throws(() =>
            buildAuthorization({ method: 'GET', uri: '/', username: 'u', password: 'p', challenge, nc: 1 }),
        );
    });
});
