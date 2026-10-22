import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { InfoWinRestApi } from '../src/api/InfoWinRestApi';
import { categorize, indexCatalog } from '../src/discovery/CapabilityRegistry';
import { scanSystem } from '../src/discovery/SystemScanner';
import type { Catalog } from '../src/models/Datapoint';
import { PollingService, type PollingCallbacks, type PollTarget } from '../src/services/PollingService';
import { StateRegistry } from '../src/services/StateRegistry';
import { gasBoilerFixture, OID } from './fixtures/gasBoiler';
import { FakeController } from './helpers/FakeController';
import { makeClient } from './helpers/util';

const wait = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

describe('categorisation', () => {
    it('puts measurement groups in normal, settings in slow, user overrides in fast', async () => {
        const fake = new FakeController(gasBoilerFixture);
        await fake.start();
        const c = makeClient(fake);
        const cat = await scanSystem(new InfoWinRestApi(c), { excludedNodes: new Set(), includeLon: true });
        c.close();
        await fake.stop();
        const groups = indexCatalog(cat).groups;
        assert.equal(categorize(groups.get('n17.f0.l3')!, new Set()), 'normal');
        assert.equal(categorize(groups.get('n16.f0.l3')!, new Set()), 'slow');
        assert.equal(categorize(groups.get('n16.f0.l3')!, new Set(['n16.f0.l3'])), 'fast');
    });
});

describe('PollingService', () => {
    let fake: FakeController;
    let catalog: Catalog;
    let api: InfoWinRestApi;
    let close: () => void;
    let events: string[];

    const callbacks = (): PollingCallbacks => ({
        onGroup: async (g, r) => {
            events.push(`group:${g.key}:${r.datapoints.length}`);
        },
        onLon: async (g, v) => {
            events.push(`lon:${g.key}:${v.length}`);
        },
        onOnline: () => events.push('online'),
        onOffline: () => events.push('offline'),
        onAuthFailure: () => events.push('auth'),
    });

    beforeEach(async () => {
        events = [];
        fake = new FakeController(gasBoilerFixture);
        await fake.start();
        const c = makeClient(fake, { timeoutMs: 300, retries: 0 });
        close = (): void => c.close();
        api = new InfoWinRestApi(c);
        catalog = await scanSystem(api, { excludedNodes: new Set(), includeLon: true });
    });
    afterEach(async () => {
        close();
        await fake.stop();
    });

    const targets = (): PollTarget[] =>
        [...indexCatalog(catalog).groups.values()].map(group => ({ group, category: categorize(group, new Set()) }));

    it('polls each group in exactly one category (deduplicated) and goes online', async () => {
        const p = new PollingService(api, callbacks(), { intervals: { normal: 1, slow: 1 }, includeLon: true });
        p.setTargets(targets());
        (p as unknown as { running: boolean }).running = true;
        assert.equal(await p.runCycle('normal'), true);
        const normal = events.filter(e => e.startsWith('group:')).length;
        assert.equal(await p.runCycle('slow'), true);
        const all = events.filter(e => e.startsWith('group:')).length;
        assert.equal(all, targets().length, 'every group read once across categories');
        assert.ok(normal < all);
        assert.ok(events.includes('online'));
        assert.ok(
            events.some(e => e.startsWith('lon:n17.f0.l9:2')),
            'LON read in slow category when enabled',
        );
        p.stop();
    });

    it('declares the controller offline after repeated failures and back online on recovery', async () => {
        const p = new PollingService(api, callbacks(), {
            intervals: { normal: 1 },
            includeLon: false,
            offlineThreshold: 2,
        });
        p.setTargets(targets());
        (p as unknown as { running: boolean }).running = true;
        await p.runCycle('normal');
        fake.behaviour.forceStatus = 503;
        await p.runCycle('normal');
        assert.ok(!events.includes('offline'), 'one failure is tolerated');
        await p.runCycle('normal');
        assert.ok(events.includes('offline'));
        fake.behaviour = {};
        await p.runCycle('normal');
        assert.equal(events.filter(e => e === 'online').length, 2);
        assert.equal(p.failures, 0);
        p.stop();
    });

    it('stops polling on authentication failure (avoids lock-out)', async () => {
        const bad = makeClient(fake, { password: 'wrong', retries: 0 });
        const p = new PollingService(new InfoWinRestApi(bad), callbacks(), {
            intervals: { normal: 1 },
            includeLon: false,
        });
        p.setTargets(targets());
        (p as unknown as { running: boolean }).running = true;
        await p.runCycle('normal');
        assert.ok(events.includes('auth'));
        const requestsAfter = fake.requests.length;
        await wait(50);
        assert.equal(fake.requests.length, requestsAfter, 'no further requests after auth failure');
        bad.close();
    });

    it('lengthens the interval with backoff and cleans up timers on stop', async () => {
        const p = new PollingService(api, callbacks(), {
            intervals: { normal: 100 },
            includeLon: false,
            offlineThreshold: 5,
        });
        p.setTargets(targets());
        p.start();
        await wait(30);
        p.stop();
        const count = fake.requests.length;
        await wait(150);
        assert.equal(fake.requests.length, count, 'no requests after stop');
    });

    it('disabled categories are never scheduled', async () => {
        const p = new PollingService(api, callbacks(), {
            intervals: { fast: 0, normal: 0, slow: 0 },
            includeLon: false,
        });
        p.setTargets(targets());
        const before = fake.requests.length;
        p.start();
        await wait(60);
        p.stop();
        assert.equal(fake.requests.length, before);
    });
});

describe('multiple instances', () => {
    it('keep catalogs, clients and registries fully independent', async () => {
        const a = new FakeController(gasBoilerFixture);
        const other = JSON.parse(JSON.stringify(gasBoilerFixture)) as typeof gasBoilerFixture;
        (other.lookups['/1/15/0/3'] as Array<Record<string, unknown>>)[0].value = '12.3';
        const b = new FakeController(other, { username: 'USER', password: 'other-pw' });
        await Promise.all([a.start(), b.start()]);
        const ca = makeClient(a);
        const cb = makeClient(b, { password: 'other-pw' });
        const [catA, catB] = await Promise.all([
            scanSystem(new InfoWinRestApi(ca), { excludedNodes: new Set(), includeLon: false }),
            scanSystem(new InfoWinRestApi(cb), { excludedNodes: new Set(), includeLon: false }),
        ]);
        ca.close();
        cb.close();
        assert.equal(indexCatalog(catA).byOid.get(OID.boilerTemp)!.value, '64.5');
        assert.equal(indexCatalog(catB).byOid.get(OID.boilerTemp)!.value, '12.3');
        assert.ok(a.requests.every(r => !r.url.includes('other')));
        assert.notEqual(
            new StateRegistry({} as never, {
                writesEnabled: false,
                writeAllowlist: new Set(),
                exposeRaw: false,
                includeLon: false,
            }),
            new StateRegistry({} as never, {
                writesEnabled: false,
                writeAllowlist: new Set(),
                exposeRaw: false,
                includeLon: false,
            }),
        );
        await Promise.all([a.stop(), b.stop()]);
    });
});
