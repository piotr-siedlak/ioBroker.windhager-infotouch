import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { WindhagerError } from '../src/api/errors';
import { FakeController } from './helpers/FakeController';
import { makeClient } from './helpers/util';
import { gasBoilerFixture } from './fixtures/gasBoiler';

describe('HttpClient', () => {
    let fake: FakeController;
    beforeEach(async () => {
        fake = new FakeController(gasBoilerFixture);
        await fake.start();
    });
    afterEach(async () => fake.stop());

    const kind = async (p: Promise<unknown>): Promise<string> => {
        try {
            await p;
            return 'none';
        } catch (e) {
            return e instanceof WindhagerError ? e.kind : `other:${String(e)}`;
        }
    };

    it('completes the digest handshake and reuses the challenge', async () => {
        const c = makeClient(fake);
        await c.getJson('/api/1.0/info/deviceinfo');
        await c.getJson('/api/1.0/info/deviceinfo');
        c.close();
        assert.equal(fake.challenges, 1, 'second request must reuse the nonce');
        assert.equal(fake.requests.filter(r => r.authorized).length, 2);
    });

    it('reports bad credentials as an auth error and does not retry', async () => {
        const c = makeClient(fake, { password: 'wrong' });
        assert.equal(await kind(c.getJson('/api/1.0/lookup/1')), 'auth');
        c.close();
        assert.ok(fake.requests.length <= 2, 'one challenge + one authenticated attempt only');
    });

    it('times out on a hanging controller', async () => {
        fake.behaviour.hang = true;
        const c = makeClient(fake, { timeoutMs: 150, retries: 0 });
        assert.equal(await kind(c.getJson('/api/1.0/lookup/1')), 'timeout');
        c.close();
    });

    it('retries GET on 5xx and succeeds', async () => {
        fake.behaviour.failFirst = 2;
        const c = makeClient(fake);
        const data = await c.getJson('/api/1.0/info/deviceinfo');
        c.close();
        assert.ok(Array.isArray(data));
    });

    it('gives up after the configured retries', async () => {
        fake.behaviour.forceStatus = 503;
        const c = makeClient(fake, { retries: 1 });
        assert.equal(await kind(c.getJson('/api/1.0/lookup/1')), 'http');
        c.close();
        assert.equal(fake.requests.filter(r => r.authorized).length, 2);
    });

    it('never retries a PUT', async () => {
        fake.behaviour.rejectWritesWith = 500;
        const c = makeClient(fake);
        assert.equal(await kind(c.putJson('/api/1.0/datapoint', { OID: '/1/15/0/3/11/0', value: '70' })), 'http');
        c.close();
        assert.equal(fake.requests.filter(r => r.method === 'PUT' && r.authorized).length, 1);
    });

    it('maps 404, malformed JSON and unreachable hosts', async () => {
        fake.behaviour.forceStatus = 404;
        const a = makeClient(fake);
        assert.equal(await kind(a.getJson('/api/1.0/lookup/1')), 'unsupported');
        a.close();

        fake.behaviour = { malformed: true };
        const b = makeClient(fake);
        assert.equal(await kind(b.getJson('/api/1.0/lookup/1')), 'malformed');
        b.close();

        const port = fake.port;
        await fake.stop();
        const c = makeClient(fake, { port, retries: 0 });
        assert.equal(await kind(c.getJson('/api/1.0/lookup/1')), 'connection');
        c.close();
        await fake.start(); // keep afterEach symmetrical
    });

    it('bounds concurrency', async () => {
        fake.behaviour.delayMs = 30;
        const c = makeClient(fake, { maxConcurrency: 2 });
        await c.getJson('/api/1.0/info/deviceinfo'); // authenticate first
        fake.maxConcurrent = 0;
        await Promise.all(Array.from({ length: 8 }, () => c.getJson('/api/1.0/info/deviceinfo')));
        c.close();
        assert.ok(fake.maxConcurrent <= 2, `saw ${fake.maxConcurrent} parallel requests`);
    });

    it('never puts the password on the wire in clear text', async () => {
        const c = makeClient(fake);
        await c.getJson('/api/1.0/info/deviceinfo');
        c.close();
        assert.ok(fake.requests.every(r => !JSON.stringify(r).includes('secret-pw')));
    });
});
