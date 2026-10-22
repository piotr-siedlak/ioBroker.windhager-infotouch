import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { InfoWinRestApi } from '../src/api/InfoWinRestApi';
import { indexCatalog } from '../src/discovery/CapabilityRegistry';
import { scanSystem } from '../src/discovery/SystemScanner';
import type { Catalog } from '../src/models/Datapoint';
import { CommandService, validateValue, type CommandOptions } from '../src/services/CommandService';
import { DiagnosticsService } from '../src/services/DiagnosticsService';
import { Q_STALE, StateRegistry, type AdapterPort } from '../src/services/StateRegistry';
import { gasBoilerFixture, OID } from './fixtures/gasBoiler';
import { FakeController } from './helpers/FakeController';
import { makeClient } from './helpers/util';

class MemoryPort implements AdapterPort {
    public objects = new Map<
        string,
        { type: string; common?: Record<string, unknown>; native: Record<string, unknown> }
    >();
    public states = new Map<string, { val: unknown; q?: number }>();
    public extendCalls = 0;
    public async extendObject(
        id: string,
        obj: { type: string; common?: Record<string, unknown>; native?: Record<string, unknown> },
    ): Promise<void> {
        this.extendCalls++;
        const old = this.objects.get(id);
        this.objects.set(id, {
            type: obj.type,
            common: { ...(old?.common ?? {}), ...(obj.common ?? {}) },
            native: { ...(old?.native ?? {}), ...(obj.native ?? {}) },
        });
    }
    public async setStateChanged(id: string, state: { val: unknown; ack: boolean; q?: number }): Promise<void> {
        assert.equal(state.ack, true, 'device-originated updates must be acknowledged');
        this.states.set(id, { val: state.val, q: state.q });
    }
    public async listObjects(
        prefix: string,
    ): Promise<Array<{ id: string; type: string; native: Record<string, unknown> }>> {
        return [...this.objects]
            .filter(([id]) => id.startsWith(prefix))
            .map(([id, o]) => ({ id, type: o.type, native: o.native }));
    }
}

const registryOpts = { writesEnabled: false, writeAllowlist: new Set<string>(), exposeRaw: false, includeLon: true };

describe('StateRegistry', () => {
    let fake: FakeController;
    let catalog: Catalog;
    beforeEach(async () => {
        fake = new FakeController(gasBoilerFixture);
        await fake.start();
        const c = makeClient(fake);
        catalog = await scanSystem(new InfoWinRestApi(c), { excludedNodes: new Set(), includeLon: true });
        c.close();
    });
    afterEach(async () => fake.stop());

    it('creates read-only states by default, with native metadata and no writable flag', async () => {
        const port = new MemoryPort();
        await new StateRegistry(port, registryOpts).sync(catalog);
        const sp = port.objects.get(
            StateRegistry.stateId({ nodeId: 16, fctId: 0, lookupId: 3, memberId: 21, instance: 0 }),
        )!;
        assert.equal(sp.common!.write, false);
        assert.equal(sp.common!.unit, '°C');
        assert.equal(sp.native.oid, OID.hc1RoomSetpoint);
        assert.equal(sp.native.writeProtected, false);
    });

    it('exposes write only when enabled AND allow-listed AND controller-writable', async () => {
        const port = new MemoryPort();
        const reg = new StateRegistry(port, {
            ...registryOpts,
            writesEnabled: true,
            writeAllowlist: new Set([OID.hc1RoomSetpoint, OID.boilerTemp]),
        });
        await reg.sync(catalog);
        const flag = (oid: string): unknown => port.objects.get(reg.writableStateFor(oid) ?? '')?.common?.write;
        assert.equal(flag(OID.hc1RoomSetpoint), true);
        assert.equal(reg.writableStateFor(OID.boilerTemp), undefined, 'write-protected on the controller');
        assert.equal(reg.writableStateFor(OID.hc1Mode), undefined, 'writable but not allow-listed');
    });

    it('is idempotent across restarts: same ids, no duplicates', async () => {
        const port = new MemoryPort();
        await new StateRegistry(port, registryOpts).sync(catalog);
        const ids = [...port.objects.keys()].sort();
        await new StateRegistry(port, registryOpts).sync(catalog);
        assert.deepEqual([...port.objects.keys()].sort(), ids);
    });

    it('publishes typed, acknowledged values and treats placeholders as null', async () => {
        const port = new MemoryPort();
        const reg = new StateRegistry(port, registryOpts);
        await reg.sync(catalog);
        await reg.applyValues([...indexCatalog(catalog).datapoints.values()]);
        const id = (oid: string): string =>
            reg.oidForState(oid) ?? StateRegistry.stateId(indexCatalog(catalog).byOid.get(oid)!);
        assert.equal(port.states.get(id(OID.boilerTemp))!.val, 64.5);
        assert.equal(
            port.states.get(StateRegistry.stateId(indexCatalog(catalog).byOid.get(OID.placeholder)!))!.val,
            null,
        );
    });

    it('marks disappeared datapoints stale instead of deleting, and revives them', async () => {
        const port = new MemoryPort();
        await new StateRegistry(port, registryOpts).sync(catalog);
        const before = port.objects.size;
        const reduced: Catalog = JSON.parse(JSON.stringify(catalog));
        const group = reduced.modules[1].functions[0].lookups[0];
        const removed = group.datapoints.pop()!;
        const result = await new StateRegistry(port, registryOpts).sync(reduced);
        const id = StateRegistry.stateId(removed);
        assert.equal(result.stale, 1);
        assert.equal(port.objects.size, before, 'nothing deleted');
        assert.equal(port.objects.get(id)!.native.stale, true);
        assert.equal(port.states.get(id)!.q, Q_STALE);
        const back = await new StateRegistry(port, registryOpts).sync(catalog);
        assert.equal(back.revived, 1);
        assert.equal(port.objects.get(id)!.native.stale, false);
    });

    it('creates raw and LON states only when requested', async () => {
        const plain = new MemoryPort();
        await new StateRegistry(plain, { ...registryOpts, includeLon: false }).sync(catalog);
        assert.ok(![...plain.objects.keys()].some(k => k.startsWith('raw.') || k.startsWith('lon.')));
        const full = new MemoryPort();
        await new StateRegistry(full, { ...registryOpts, exposeRaw: true }).sync(catalog);
        assert.ok([...full.objects.keys()].some(k => k.startsWith('raw.')));
        assert.ok([...full.objects.keys()].some(k => k.startsWith('lon.')));
    });

    it('flags last known values stale when the controller goes offline', async () => {
        const port = new MemoryPort();
        const reg = new StateRegistry(port, registryOpts);
        await reg.sync(catalog);
        await reg.applyValues([...indexCatalog(catalog).datapoints.values()]);
        await reg.markAllStale();
        const id = StateRegistry.stateId(indexCatalog(catalog).byOid.get(OID.boilerTemp)!);
        assert.deepEqual(port.states.get(id), { val: 64.5, q: Q_STALE });
    });
});

describe('CommandService', () => {
    let fake: FakeController;
    let catalog: Catalog;
    let api: InfoWinRestApi;
    let audits: string[];
    let closeClient: () => void;

    beforeEach(async () => {
        fake = new FakeController(gasBoilerFixture);
        await fake.start();
        const c = makeClient(fake);
        closeClient = (): void => c.close();
        api = new InfoWinRestApi(c);
        catalog = await scanSystem(api, { excludedNodes: new Set(), includeLon: false });
        audits = [];
    });
    afterEach(async () => {
        closeClient();
        await fake.stop();
    });

    const service = (over: Partial<CommandOptions> = {}): CommandService => {
        const idx = indexCatalog(catalog);
        return new CommandService(api, {
            enabled: true,
            allowlist: new Set([OID.hc1RoomSetpoint, OID.hc1Mode, OID.boilerTemp, OID.boilerSetpoint]),
            verify: true,
            isConnected: () => true,
            findDatapoint: oid => idx.byOid.get(oid),
            audit: e => audits.push(`${e.oid}:${e.outcome}`),
            readbackDelayMs: 1,
            ...over,
        });
    };
    const puts = (): number => fake.requests.filter(r => r.method === 'PUT').length;

    it('writes nothing in read-only mode', async () => {
        const r = await service({ enabled: false }).write(OID.hc1RoomSetpoint, 22);
        assert.deepEqual([r.ok, !r.ok && r.code], [false, 'disabled']);
        assert.equal(puts(), 0);
    });

    it('refuses when offline, unknown, not allow-listed, or write-protected', async () => {
        const codes = async (s: CommandService, oid: string): Promise<unknown> => {
            const r = await s.write(oid, 22);
            return r.ok ? 'ok' : r.code;
        };
        assert.equal(await codes(service({ isConnected: () => false }), OID.hc1RoomSetpoint), 'offline');
        assert.equal(await codes(service(), '/1/9/9/9/9/9'), 'unknown-datapoint');
        assert.equal(await codes(service({ allowlist: new Set() }), OID.hc1RoomSetpoint), 'not-allowlisted');
        assert.equal(await codes(service(), OID.boilerTemp), 'not-writable');
        assert.equal(puts(), 0);
    });

    it('validates range, step, enum and type before sending', async () => {
        const s = service();
        for (const v of [9, 31, 21.3, 'hot', NaN, null, true]) {
            const r = await s.write(OID.hc1RoomSetpoint, v);
            assert.equal(r.ok, false, String(v));
            assert.equal(!r.ok && r.code, 'invalid', String(v));
        }
        assert.equal((await s.write(OID.hc1Mode, 7)).ok, false);
        assert.equal(puts(), 0);
    });

    it('sends the exact documented request and confirms by read-back', async () => {
        const r = await service().write(OID.hc1RoomSetpoint, 22.5);
        assert.deepEqual(r, { ok: true, value: 22.5, verified: true });
        const put = fake.requests.find(x => x.method === 'PUT')!;
        assert.equal(put.url, '/api/1.0/datapoint');
        assert.deepEqual(JSON.parse(put.body!), { OID: OID.hc1RoomSetpoint, value: '22.5' }, 'values are strings');
        assert.ok(audits.some(a => a.endsWith('confirmed')));
    });

    it('formats integers without decimals', async () => {
        await service().write(OID.hc1Mode, 2);
        assert.equal(JSON.parse(fake.requests.find(x => x.method === 'PUT')!.body!).value, '2');
    });

    it('reports a controller rejection', async () => {
        fake.behaviour.rejectWritesWith = 403;
        const r = await service().write(OID.hc1RoomSetpoint, 22);
        assert.equal(!r.ok && r.code, 'rejected');
    });

    it('detects a read-back mismatch and never reports success on HTTP 200 alone', async () => {
        fake.behaviour.ignoreWrites = true;
        const r = await service().write(OID.hc1RoomSetpoint, 25);
        assert.equal(r.ok, false);
        assert.equal(!r.ok && r.code, 'mismatch');
        assert.equal(!r.ok && r.deviceValue, 21);
    });

    it('confirms a value the controller applies with a delay', async () => {
        fake.behaviour.applyAfterReads = 1;
        const r = await service().write(OID.hc1RoomSetpoint, 23);
        assert.deepEqual(r, { ok: true, value: 23, verified: true });
    });

    it('reports mismatch only after all read-back attempts', async () => {
        fake.behaviour.ignoreWrites = true;
        await service({ readbackAttempts: 3 }).write(OID.hc1RoomSetpoint, 25);
        const singleReads = fake.requests.filter(
            x => x.method === 'GET' && x.url === `/api/1.0/lookup${OID.hc1RoomSetpoint}`,
        );
        assert.equal(singleReads.filter(x => x.authorized).length, 3);
    });

    it('serialises concurrent writes in submission order', async () => {
        const s = service();
        const results = await Promise.all([
            s.write(OID.hc1RoomSetpoint, 20),
            s.write(OID.hc1RoomSetpoint, 23),
            s.write(OID.hc1RoomSetpoint, 24),
        ]);
        assert.ok(results.every(r => r.ok));
        const order = fake.requests.filter(x => x.method === 'PUT').map(x => JSON.parse(x.body!).value);
        assert.deepEqual(order, ['20', '23', '24']);
        assert.equal(fake.values.get(OID.hc1RoomSetpoint), '24');
    });

    it('never writes at construction time', () => {
        service();
        assert.equal(puts(), 0);
    });

    it('validateValue handles step origin and tolerance', () => {
        const dp = indexCatalog(catalog).byOid.get(OID.hc1RoomSetpoint)!;
        assert.equal(validateValue(dp, 10.5).ok, true);
        assert.equal(validateValue(dp, 10.25).ok, false);
        assert.equal(validateValue(dp, 30).ok, true);
    });
});

describe('DiagnosticsService', () => {
    it('exports anonymised data without host, serials, credentials or values', async () => {
        const fake = new FakeController(gasBoilerFixture);
        await fake.start();
        const c = makeClient(fake);
        const catalog = await scanSystem(new InfoWinRestApi(c), { excludedNodes: new Set(), includeLon: false });
        c.close();
        await fake.stop();
        const d = new DiagnosticsService();
        d.record({ method: 'GET', path: '/x', durationMs: 12 });
        d.record({ method: 'GET', path: '/y', durationMs: 0, error: 'boom' });
        const text = JSON.stringify(d.exportAnonymized('192.168.10.20', catalog));
        for (const secret of ['192.168.10.20', 'N000000015', '0000001c01000000', 'secret-pw', '64.5']) {
            assert.ok(!text.includes(secret), `leaked ${secret}`);
        }
        assert.match(text, /192\.168\.\*\.\*/);
        assert.equal(d.snapshot().failures, 1);
    });
});
