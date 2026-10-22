/**
 * Tests against a sanitised real capture (MB6621 fw 0.10.4, UMUMLZ + ZSP-SOFU, eBUS gas boiler).
 * Unlike the synthetic fixture, this proves behaviour against what a real controller sends.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { InfoWinRestApi } from '../src/api/InfoWinRestApi';
import { loadTextTables } from '../src/api/ResourceTexts';
import { indexCatalog, summarize } from '../src/discovery/CapabilityRegistry';
import { scanSystem } from '../src/discovery/SystemScanner';
import { applyLabels } from '../src/mappings/Naming';
import { shapeFor } from '../src/mappings/StateRoles';
import type { Catalog, Datapoint } from '../src/models/Datapoint';
import { readObjects } from '../src/services/ObjectService';
import { StateRegistry, type AdapterPort } from '../src/services/StateRegistry';
import { FakeController, type Fixture } from './helpers/FakeController';
import { makeClient } from './helpers/util';

const fixture = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'mb6621-real.json'), 'utf8')) as Fixture;

class Port implements AdapterPort {
    public objects = new Map<
        string,
        { type: string; common?: Record<string, unknown>; native: Record<string, unknown> }
    >();
    public states = new Map<string, unknown>();
    public async extendObject(
        id: string,
        obj: { type: string; common?: Record<string, unknown>; native?: Record<string, unknown> },
    ): Promise<void> {
        const old = this.objects.get(id);
        this.objects.set(id, {
            type: obj.type,
            common: { ...old?.common, ...obj.common },
            native: { ...old?.native, ...obj.native },
        });
    }
    public async setStateChanged(id: string, s: { val: unknown }): Promise<void> {
        this.states.set(id, s.val);
    }
    public async listObjects(
        prefix: string,
    ): Promise<Array<{ id: string; type: string; native: Record<string, unknown> }>> {
        return [...this.objects]
            .filter(([id]) => id.startsWith(prefix))
            .map(([id, o]) => ({ id, type: o.type, native: o.native }));
    }
}

describe('real controller capture (MB6621 0.10.4)', () => {
    let fake: FakeController;
    let catalog: Catalog;
    let port: Port;

    const load = async (language: string): Promise<Catalog> => {
        const c = makeClient(fake);
        const api = new InfoWinRestApi(c);
        const cat = await scanSystem(api, { excludedNodes: new Set(), includeLon: true });
        applyLabels(cat, await loadTextTables(c, language));
        c.close();
        return cat;
    };

    before(async () => {
        fake = new FakeController(fixture);
        await fake.start();
        catalog = await load('en');
        port = new Port();
        const reg = new StateRegistry(port, {
            writesEnabled: false,
            writeAllowlist: new Set(),
            exposeRaw: false,
            includeLon: true,
        });
        await reg.sync(catalog);
        await reg.applyValues([...indexCatalog(catalog).datapoints.values()]);
        const c = makeClient(fake);
        for (const o of await readObjects(new InfoWinRestApi(c), catalog)) {
            await reg.applyObjectValue(o.oid, o.value);
        }
        c.close();
    });
    after(async () => fake.stop());

    const dp = (oid: string): Datapoint => indexCatalog(catalog).byOid.get(oid)!;
    const obj = (id: string): { type: string; common?: Record<string, unknown>; native: Record<string, unknown> } =>
        port.objects.get(id)!;

    it('discovers both modules, skips the locked circuit and finds the LON variables', () => {
        const s = summarize(catalog);
        assert.equal(s.modules, 2);
        assert.equal(s.datapoints, 78, '68 from menus + 10 known only from the controller cache');
        assert.equal(s.lonVariables, 29 + 58);
        assert.deepEqual(
            catalog.modules.map(m => m.label),
            ['ZSP-SOFU', 'UMUMLZ'],
        );
        assert.equal(catalog.modules[1].functions.find(f => f.fctId === 1)!.lookups.length, 0, 'locked UM (2)');
    });

    it('places every datapoint by its OID display code, without collisions', () => {
        const ids = [...indexCatalog(catalog).datapoints.values()].map(d => StateRegistry.stateId(d));
        assert.equal(new Set(ids).size, ids.length);
        assert.ok(
            ids.every(id => /^modules\.node_\d+\.fn_\d+\.\d{2}-\d{3}$/.test(id)),
            ids.find(id => !/^modules\.node_\d+\.fn_\d+\.\d{2}-\d{3}$/.test(id)),
        );
        assert.ok(obj('modules.node_15.fn_0.03-051'));
        assert.ok(![...port.objects.keys()].some(k => /\.grp_\d+$/.test(k)), 'no phantom group channels');
    });

    it('names datapoints like the controller UI (menu level + variable)', () => {
        assert.equal(obj('modules.node_15.fn_0.03-051').common!.name, 'Room temp. set points: Heating mode');
        assert.equal(obj('modules.node_15.fn_0.07-008').common!.name, 'Heating limits: Max. flow temp.');
        assert.equal(
            obj('modules.node_14.fn_0.09-057').common!.name,
            'External heating demand: Set temperature ext. heating requirement',
        );
        assert.equal(obj('modules.node_15.fn_0.00-000').common!.name, 'Outside temperature (00-000)');
        assert.equal(obj('modules.node_15.fn_0').common!.name, 'UMLZ (1)');
        // Every menu-listed datapoint gets a real name. Only 02-002 (cache-only, no text in any language) stays a code.
        const unnamed = [...port.objects].filter(
            ([id, o]) =>
                o.type === 'state' && id.startsWith('modules.') && /^\d{2}-\d{3}$/.test(String(o.common!.name)),
        );
        assert.deepEqual(
            unnamed.map(([id]) => id),
            ['modules.node_15.fn_0.02-002'],
        );
    });

    it('types values correctly: temperatures, enums from texts, dates and times as text', () => {
        assert.equal(port.states.get('modules.node_15.fn_0.00-007'), 25.5);
        assert.equal(obj('modules.node_15.fn_0.00-007').common!.role, 'value.temperature');
        assert.deepEqual(shapeFor(dp('/1/15/0/3/50/0'), false).states, {
            0: 'Stand-by',
            1: 'Heating program 1',
            2: 'Heating program 2',
            3: 'Heating program 3',
            4: 'Heating mode',
            5: 'Setback mode',
            7: '7',
        });
        assert.equal(
            shapeFor(dp('/1/15/0/7/76/0'), false).states![1],
            'Mixer - Radiators',
            'texts without an enum list',
        );
        assert.equal(port.states.get('modules.node_15.fn_0.03-078'), '22.10.2026');
        assert.equal(obj('modules.node_15.fn_0.03-078').common!.type, 'string');
        assert.equal(obj('modules.node_15.fn_0.03-078').common!.unit, undefined, 'numeric unit id "20" is not a unit');
        assert.equal(port.states.get('modules.node_15.fn_0.02-072'), '14:54');
        assert.equal(port.states.get('modules.node_15.fn_0.02-010'), 0, 'duration in minutes stays numeric');
    });

    it('adds cache-only values (actual room/flow temperature, time programs) and names them', () => {
        assert.equal(obj('modules.node_15.fn_0.00-001').common!.name, 'Actual (00-001)');
        assert.equal(port.states.get('modules.node_15.fn_0.00-001'), null, "'-.-' means no sensor value");
        assert.equal(obj('modules.node_15.fn_0.03-061').common!.name, 'Time program 1 (03-061)');
        assert.equal(obj('modules.node_14.fn_0.04-092').common!.name, 'Software version firing automate (04-092)');
    });

    it('reads structured objects: versions as text, time programs as JSON', () => {
        assert.equal(port.states.get('modules.node_15.fn_0.04-092'), 'V 1.20');
        assert.equal(port.states.get('modules.node_15.fn_0.04-093'), 'E1');
        assert.equal(obj('modules.node_15.fn_0.03-061').common!.role, 'json');
        assert.match(String(port.states.get('modules.node_15.fn_0.03-061')), /"switchPoints"/);
    });

    it('is read-only by default and only ever issued GET requests', () => {
        assert.ok([...port.objects.values()].every(o => o.common?.write !== true));
        assert.ok(fake.requests.every(r => r.method === 'GET'));
    });

    it('supports German names from the same controller', async () => {
        const de = await load('de');
        const label = indexCatalog(de).byOid.get('/1/15/0/3/51/0')!.label!;
        assert.notEqual(label, 'Room temp. set points: Heating mode');
        assert.ok(label.length > 3);
    });
});
