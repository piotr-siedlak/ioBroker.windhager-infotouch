import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseDatapoint, parseEnumField, parseLonVariable, parseOid } from '../src/api/parsers';
import { coerceValue, shapeFor } from '../src/mappings/StateRoles';
import { roleForUnit } from '../src/mappings/Units';
import { maskHost, maskSerial, scrub } from '../src/utils/Sanitization';
import { normalizeConfig } from '../src/utils/Validation';

describe('parsers', () => {
    it('parses OIDs strictly', () => {
        assert.deepEqual(parseOid('/1/15/0/3/50/0'), {
            subnet: 1,
            nodeId: 15,
            fctId: 0,
            groupNr: 3,
            memberNr: 50,
            instance: 0,
        });
        assert.equal(parseOid('/2/97/0/1/2/0')?.subnet, 2);
        for (const bad of ['', '/1/15/0/3/50', '/1/15/0/3/50/0/1', '/1/a/0/3/50/0', '../1/15/0/3/50/0']) {
            assert.equal(parseOid(bad), null, bad);
        }
    });

    it('parses enum fields given as JSON text, arrays, or garbage', () => {
        assert.deepEqual(parseEnumField('[0,1,2]'), [0, 1, 2]);
        assert.deepEqual(parseEnumField([3, 4]), [3, 4]);
        for (const bad of ['', 'nope', '["a"]', '[]', null, undefined, 5]) {
            assert.equal(parseEnumField(bad), null);
        }
    });

    it('rejects datapoints without usable OID and tolerates odd field types', () => {
        assert.equal(parseDatapoint(null), null);
        assert.equal(parseDatapoint({ name: 'x' }), null);
        assert.equal(parseDatapoint({ OID: '/bad' }), null);
        const dp = parseDatapoint({ OID: '/1/1/0/1/1/0', value: 3, minValue: 'abc', writeProt: 'false', step: 0.5 })!;
        assert.equal(dp.value, '3');
        assert.equal(dp.min, null);
        assert.equal(dp.writeProtected, false);
        assert.equal(dp.step, 0.5);
    });

    it('parses LON variables and keeps unknown SNVT raw', () => {
        const nv = parseLonVariable({ nvName: 'x', nvIndex: '7', snvtName: 'SNVT_weird', value: '12' }, 1, 2, 3)!;
        assert.equal(nv.key, 'n1.f2.l3.nv7');
        assert.equal(nv.snvtName, 'SNVT_weird');
        assert.equal(nv.value, '12');
        assert.equal(parseLonVariable({ nvName: 'x' }, 1, 2, 3), null, 'missing index');
        assert.equal(parseLonVariable({ nvIndex: 1 }, 1, 2, 3), null, 'missing name');
    });
});

describe('state mapping', () => {
    const base = parseDatapoint({
        OID: '/1/1/0/1/1/0',
        value: '21.5',
        unit: '°C',
        minValue: '5',
        maxValue: '30',
        step: '0.5',
        writeProt: false,
    })!;

    it('maps units to roles and keeps the native unit', () => {
        assert.equal(roleForUnit('°C'), 'value.temperature');
        assert.equal(roleForUnit('kWh'), 'value.energy');
        assert.equal(roleForUnit('weird'), 'value');
        assert.equal(roleForUnit(null), 'value');
        const ro = shapeFor(base, false);
        assert.deepEqual(
            [ro.type, ro.role, ro.unit, ro.min, ro.max, ro.step],
            ['number', 'value.temperature', '°C', 5, 30, 0.5],
        );
        assert.equal(shapeFor(base, true).role, 'level.temperature');
    });

    it('maps enums to number states with the native code list', () => {
        const dp = { ...base, unit: null, enumValues: [0, 1, 2] };
        const s = shapeFor(dp, true);
        assert.equal(s.type, 'number');
        assert.deepEqual(Object.keys(s.states!), ['0', '1', '2']);
    });

    it('falls back to string for non-numeric points and coerces defensively', () => {
        const text = { ...base, unit: null, min: null, max: null, value: 'OK' };
        assert.equal(shapeFor(text, false).type, 'string');
        assert.equal(coerceValue('abc', 'number'), null);
        assert.equal(coerceValue(null, 'number'), null);
        assert.equal(coerceValue('3.5', 'number'), 3.5);
        assert.equal(coerceValue('OK', 'string'), 'OK');
    });
});

describe('config validation', () => {
    it('is read-only and TLS-verifying by default', () => {
        const { config } = normalizeConfig({ host: '192.168.1.5' });
        assert.equal(config.writesEnabled, false);
        assert.equal(config.verifyTls, true);
        assert.equal(config.verifyWrites, true);
    });

    it('treats only boolean true as write enable and only false as TLS disable', () => {
        assert.equal(
            normalizeConfig({ host: 'a', writesEnabled: 'true' as unknown as boolean }).config.writesEnabled,
            false,
        );
        assert.equal(normalizeConfig({ host: 'a', verifyTls: 0 as unknown as boolean }).config.verifyTls, true);
        assert.equal(normalizeConfig({ host: 'a', verifyTls: false }).config.verifyTls, false);
    });

    it('rejects hosts with scheme/path and flags a missing host', () => {
        assert.ok(normalizeConfig({ host: 'http://1.2.3.4/' }).problems.length > 0);
        assert.ok(normalizeConfig({ host: '' }).problems.length > 0);
        assert.equal(normalizeConfig({ host: '10.0.0.2' }).problems.length, 0);
        assert.equal(normalizeConfig({ host: 'infowin.local' }).problems.length, 0);
    });

    it('parses allow-list and node list, dropping invalid entries', () => {
        const { config, problems } = normalizeConfig({
            host: 'a',
            writeAllowlist: '/1/16/0/3/21/0\n/1/16/0/3/20/0, ../etc/passwd',
            excludedNodes: '17, x, 18',
        });
        assert.deepEqual([...config.writeAllowlist], ['/1/16/0/3/21/0', '/1/16/0/3/20/0']);
        assert.deepEqual([...config.excludedNodes], [17, 18]);
        assert.equal(problems.length, 2);
    });

    it('clamps numeric limits', () => {
        const { config } = normalizeConfig({ host: 'a', pollFastSec: 1, maxConcurrency: 99, timeoutMs: 1 });
        assert.equal(config.pollFastSec, 10);
        assert.equal(config.maxConcurrency, 4);
        assert.equal(config.timeoutMs, 1000);
    });
});

describe('sanitization', () => {
    it('scrubs authorization data and literal secrets', () => {
        const out = scrub('Authorization: Digest username="u", response="abc" pw=topsecret', ['topsecret']);
        assert.ok(!out.includes('abc') && !out.includes('topsecret'));
    });
    it('masks hosts and serials', () => {
        assert.equal(maskHost('192.168.10.20'), '192.168.*.*');
        assert.ok(!maskHost('boiler.home.lan').includes('home'));
        assert.ok(!maskSerial('KAT03N015XYZ').includes('N015'));
    });
});
