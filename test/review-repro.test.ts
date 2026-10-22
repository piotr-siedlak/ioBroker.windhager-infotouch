/**
 * Regression tests for defects found in the Opus review of the first version.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { InfoWinRestApi } from '../src/api/InfoWinRestApi';
import { categorize, indexCatalog } from '../src/discovery/CapabilityRegistry';
import { scanSystem } from '../src/discovery/SystemScanner';
import type { Catalog } from '../src/models/Datapoint';
import { DiagnosticsService } from '../src/services/DiagnosticsService';
import { PollingService, type PollingCallbacks, type PollTarget } from '../src/services/PollingService';
import { gasBoilerFixture } from './fixtures/gasBoiler';
import { FakeController, type Fixture } from './helpers/FakeController';
import { makeClient } from './helpers/util';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe('review regressions', () => {
    let fake: FakeController;
    let api: InfoWinRestApi;
    let catalog: Catalog;
    let close: () => void;
    let events: string[];

    const callbacks = (): PollingCallbacks => ({
        onGroup: async g => {
            events.push(`group:${g.key}`);
        },
        onLon: async () => undefined,
        onOnline: () => events.push('online'),
        onOffline: () => events.push('offline'),
        onAuthFailure: () => events.push('auth'),
    });
    const targets = (): PollTarget[] =>
        [...indexCatalog(catalog).groups.values()].map(group => ({ group, category: categorize(group, new Set()) }));
    const running = (p: PollingService): void => {
        (p as unknown as { running: boolean }).running = true;
    };

    beforeEach(async () => {
        events = [];
        fake = new FakeController(clone(gasBoilerFixture));
        await fake.start();
        const c = makeClient(fake, { timeoutMs: 200, retries: 0 });
        close = (): void => c.close();
        api = new InfoWinRestApi(c);
        catalog = await scanSystem(api, { excludedNodes: new Set(), includeLon: true });
    });
    afterEach(async () => {
        close();
        await fake.stop();
    });

    it('an empty category must not mask a controller outage (default config has no fast groups)', async () => {
        const p = new PollingService(api, callbacks(), {
            intervals: { fast: 30, normal: 60 },
            includeLon: false,
            offlineThreshold: 2,
        });
        p.setTargets(targets());
        running(p);
        await p.runCycle('normal');
        fake.behaviour.hang = true;
        for (let i = 0; i < 3; i++) {
            await p.runCycle('normal');
            await p.runCycle('fast'); // no targets
        }
        p.stop();
        assert.ok(events.includes('offline'), `events: ${events.join(',')}`);
    });

    it('a single persistently failing group must not take the controller offline', async () => {
        (fake.fixture.lookups as Record<string, unknown>)['/1/17/0/3'] = 500;
        fake.fixture.paged = {};
        const p = new PollingService(api, callbacks(), {
            intervals: { normal: 60 },
            includeLon: false,
            offlineThreshold: 2,
        });
        p.setTargets(targets());
        running(p);
        for (let i = 0; i < 3; i++) {
            await p.runCycle('normal');
        }
        p.stop();
        assert.ok(!events.includes('offline'), `events: ${events.join(',')}`);
    });

    it('a failing paging request keeps the entries already received', async () => {
        fake.fixture.paged = { '/1/17/0/3': {} }; // offset request -> 404
        const g = await api.readGroup(17, 0, 3, 12);
        assert.equal(g.datapoints.length, 10);
    });

    it('paging that ignores the offset does not duplicate LON variables', async () => {
        const f: Fixture = fake.fixture;
        (f.lookups as Record<string, unknown>)['/1/17/0/9'] = Array.from({ length: 10 }, (_, i) => ({
            nvName: `nv${i}`,
            nvIndex: i,
            value: '-',
        }));
        f.paged = {};
        delete (f.paged as Record<string, unknown>)['/1/17/0/9'];
        const g = await api.readGroup(17, 0, 9, 25);
        assert.equal(g.lon.length, 10);
        assert.ok(fake.requests.filter(r => r.url.startsWith('/api/1.0/lookup/1/17/0/9')).length <= 3);
    });

    it('diagnostics export does not leak the host through error messages', () => {
        const d = new DiagnosticsService();
        d.record({ method: 'GET', path: '/x', durationMs: 1, error: 'connect ECONNREFUSED 192.168.10.20:80' });
        d.note('Offline - connect ECONNREFUSED 192.168.10.20:80');
        const text = JSON.stringify(d.exportAnonymized('192.168.10.20', null));
        assert.ok(!text.includes('192.168.10.20'), text);
    });
});
