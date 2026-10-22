import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { detectProtocol } from '../src/api/ProtocolDetector';
import { InfoWinRestApi } from '../src/api/InfoWinRestApi';
import { indexCatalog, isCacheValid, summarize } from '../src/discovery/CapabilityRegistry';
import { scanSystem } from '../src/discovery/SystemScanner';
import { findScheduleDatapoints, readSchedules } from '../src/services/ScheduleService';
import { emptyFixture, gasBoilerFixture, OID } from './fixtures/gasBoiler';
import { FakeController } from './helpers/FakeController';
import { makeClient } from './helpers/util';

describe('protocol detection', () => {
    let fake: FakeController;
    afterEach(async () => fake.stop());
    const start = async (f = gasBoilerFixture): Promise<void> => {
        fake = new FakeController(f);
        await fake.start();
    };

    it('detects the lookup API family and reports controller info', async () => {
        await start();
        const c = makeClient(fake);
        const r = await detectProtocol(c);
        c.close();
        assert.equal(r.status, 'ok');
        assert.equal(r.family, 'infowin-rest-1.0');
        assert.deepEqual(r.controller, { device: 'MB66xx', version: '1.0.2' });
    });

    it('distinguishes auth, unsupported, malformed, timeout and connection failures', async () => {
        await start();
        const bad = makeClient(fake, { password: 'nope' });
        assert.equal((await detectProtocol(bad)).status, 'auth');
        bad.close();

        fake.behaviour = { forceStatus: 404 };
        const a = makeClient(fake);
        assert.equal((await detectProtocol(a)).status, 'unsupported');
        a.close();

        fake.behaviour = { htmlLanding: true };
        const b = makeClient(fake);
        assert.equal((await detectProtocol(b)).status, 'malformed');
        b.close();

        fake.behaviour = { hang: true };
        const c = makeClient(fake, { timeoutMs: 120, retries: 0 });
        assert.equal((await detectProtocol(c)).status, 'timeout');
        c.close();

        const port = fake.port;
        await fake.stop();
        const d = makeClient(fake, { port, retries: 0 });
        assert.equal((await detectProtocol(d)).status, 'connection');
        d.close();
        await fake.start();
    });

    it('only issues GET probes (non-mutating)', async () => {
        await start();
        const c = makeClient(fake);
        await detectProtocol(c);
        c.close();
        assert.ok(fake.requests.every(r => r.method === 'GET'));
    });
});

describe('discovery', () => {
    let fake: FakeController;
    beforeEach(async () => {
        fake = new FakeController(gasBoilerFixture);
        await fake.start();
    });
    afterEach(async () => fake.stop());

    const scan = async (opts: Partial<Parameters<typeof scanSystem>[1]> = {}): ReturnType<typeof scanSystem> => {
        const c = makeClient(fake);
        try {
            return await scanSystem(new InfoWinRestApi(c), { excludedNodes: new Set(), includeLon: true, ...opts });
        } finally {
            c.close();
        }
    };

    it('builds a catalog for a gas boiler installation with metadata preserved', async () => {
        const cat = await scan();
        assert.equal(cat.modules.length, 4);
        const idx = indexCatalog(cat);
        const setpoint = idx.byOid.get(OID.hc1RoomSetpoint)!;
        assert.equal(setpoint.key, 'n16.f0.l3.m21.i0');
        assert.deepEqual(
            [setpoint.min, setpoint.max, setpoint.step, setpoint.unit, setpoint.writeProtected],
            [10, 30, 0.5, '°C', false],
        );
        assert.deepEqual(idx.byOid.get(OID.hc1Mode)!.enumValues, [0, 1, 2, 3]);
        assert.equal(idx.byOid.get(OID.placeholder)!.value, null, 'placeholder "-" is no value');
        assert.equal(idx.byOid.get(OID.noMetadata)!.writeProtected, null, 'missing flag stays unknown, not writable');
    });

    it('keeps duplicate display names apart by native id', async () => {
        const idx = indexCatalog(await scan());
        const a = idx.byOid.get(OID.hc1Flow)!;
        const b = idx.byOid.get(OID.hc1FlowDuplicate)!;
        assert.equal(a.name, b.name);
        assert.notEqual(a.key, b.key);
    });

    it('pages groups that exceed ten entries', async () => {
        const idx = indexCatalog(await scan());
        assert.equal(idx.groups.get('n17.f0.l3')!.datapoints.length, 12);
    });

    it('does not read locked functions and tolerates a failing module', async () => {
        const cat = await scan();
        assert.equal(cat.modules.find(m => m.nodeId === 15)!.functions.find(f => f.fctId === 32)!.lookups.length, 0);
        assert.equal(cat.modules.find(m => m.nodeId === 99)!.functions.length, 0);
        assert.ok(cat.skipped >= 2, 'failed module and OID-less entry are counted');
        assert.ok(fake.requests.every(r => !r.url.startsWith('/api/1.0/lookup/1/15/32/')));
    });

    it('collects LON variables as raw, read-only entries', async () => {
        const cat = await scan();
        const s = summarize(cat);
        assert.equal(s.lonVariables, 2);
        const noLon = await scan({ includeLon: false });
        assert.equal(summarize(noLon).lonVariables, 0);
    });

    it('honours excluded modules', async () => {
        const cat = await scan({ excludedNodes: new Set([17]) });
        assert.equal(cat.modules.find(m => m.nodeId === 17)!.functions.length, 0);
    });

    it('handles an empty installation', async () => {
        fake.fixture = emptyFixture;
        const cat = await scan();
        assert.equal(cat.modules.length, 0);
        assert.equal(summarize(cat).datapoints, 0);
    });

    it('aborts instead of producing a partial catalog when the controller becomes unreachable', async () => {
        fake.behaviour = { hang: true };
        const c = makeClient(fake, { timeoutMs: 100, retries: 0 });
        await assert.rejects(scanSystem(new InfoWinRestApi(c), { excludedNodes: new Set(), includeLon: false }));
        c.close();
    });

    it('validates the cache against modules, firmware and age', async () => {
        const cat = await scan();
        const current = { modules: cat.modules, version: '1.0.2', scanOptions: cat.scanOptions };
        assert.equal(isCacheValid(cat, current, 1e9), true);
        assert.equal(isCacheValid(cat, { ...current, version: '2.0' }, 1e9), false, 'firmware changed');
        assert.equal(
            isCacheValid(cat, { ...current, modules: current.modules.slice(1) }, 1e9),
            false,
            'topology changed',
        );
        assert.equal(isCacheValid(cat, current, 1000, cat.discoveredAt + 5000), false, 'expired');
        assert.equal(isCacheValid(null, current, 1e9), false);
        assert.equal(
            isCacheValid(cat, { ...current, scanOptions: { ...current.scanOptions, includeLon: false } }, 1e9),
            false,
            'LON option changed',
        );
        assert.equal(
            isCacheValid(cat, { ...current, scanOptions: { ...current.scanOptions, excludedNodes: [17] } }, 1e9),
            false,
            'exclusions changed',
        );
    });

    it('reads schedules verbatim and read-only', async () => {
        const cat = await scan();
        assert.equal(findScheduleDatapoints(cat).length, 1);
        const c = makeClient(fake);
        const snaps = await readSchedules(new InfoWinRestApi(c), cat);
        c.close();
        assert.equal(snaps.length, 1);
        assert.match(snaps[0].json, /switchPoints/);
        assert.ok(fake.requests.every(r => r.method === 'GET'));
    });
});
