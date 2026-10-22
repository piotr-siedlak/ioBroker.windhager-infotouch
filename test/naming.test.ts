import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { InfoWinRestApi } from '../src/api/InfoWinRestApi';
import {
    decodeXml,
    languageChain,
    loadTextTables,
    parseEnumTexts,
    parseLevelTexts,
    parseVariableTexts,
    parseXml,
} from '../src/api/ResourceTexts';
import { indexCatalog } from '../src/discovery/CapabilityRegistry';
import { scanSystem } from '../src/discovery/SystemScanner';
import { shapeFor } from '../src/mappings/StateRoles';
import { applyLabels, isGenericName } from '../src/mappings/Naming';
import { gasBoilerFixture, OID } from './fixtures/gasBoiler';
import { FakeController } from './helpers/FakeController';
import { makeClient } from './helpers/util';

// Synthetic text tables in the documented structure (RESEARCH.md P16); texts are invented.
const LEVELS_EN = `<?xml version="1.0" encoding="UTF-8"?>
<root><fcttyp id="14"><ebene id="3">Heating circuit &amp; room</ebene><ebene id="4">Time program</ebene></fcttyp>
<fcttyp id="1"><ebene id="3">Boiler</ebene></fcttyp></root>`;
const VARS_EN = `<?xml version="1.0" encoding="UTF-8"?>
<root><gn id="3"><mn id="10">Boiler temperature actual</mn><mn id="11">Boiler temperature setpoint</mn>
<mn id="20">Operating mode</mn><mn id="21">Room temperature setpoint</mn></gn></root>`;
const ENUMS_EN = `<?xml version="1.0" encoding="UTF-8"?>
<root><gn id="3"><mn id="20"><enum id="0">Standby</enum><enum id="1">Automatic</enum><enum id="2">Comfort</enum><enum id="3">Reduced</enum></mn></gn></root>`;
// German table encoded as ISO-8859-1 to prove charset handling.
const VARS_DE_LATIN1 = Buffer.from(
    `<?xml version="1.0" encoding="ISO-8859-1"?><root><gn id="0"><mn id="10">Kesseltemperatur Ist</mn><mn id="12">Außentemperatur</mn></gn></root>`,
    'latin1',
);

describe('XML text tables', () => {
    it('parses the three documented table shapes', () => {
        assert.equal(parseLevelTexts(LEVELS_EN).get('14:3'), 'Heating circuit & room');
        assert.equal(parseVariableTexts(VARS_EN).get('3:21'), 'Room temperature setpoint');
        assert.deepEqual(parseEnumTexts(ENUMS_EN).get('3:20'), {
            0: 'Standby',
            1: 'Automatic',
            2: 'Comfort',
            3: 'Reduced',
        });
    });

    it('decodes the charset declared in the prolog', () => {
        assert.equal(parseVariableTexts(decodeXml(VARS_DE_LATIN1)).get('0:12'), 'Außentemperatur');
    });

    it('tolerates malformed and hostile input without throwing', () => {
        for (const bad of [
            '',
            '<',
            '<root><gn id="x"><mn id="1">a</gn>',
            '<!DOCTYPE x [<!ENTITY a "b">]><root>&a;</root>',
            '<a><b></a></b>',
        ]) {
            assert.doesNotThrow(() => parseXml(bad));
            assert.doesNotThrow(() => parseVariableTexts(bad));
        }
        assert.equal(parseVariableTexts('<gn id="1"><mn id="2">  spaced\n text </mn></gn>').get('1:2'), 'spaced text');
    });

    it('builds the language chain requested -> en -> de', () => {
        assert.deepEqual(languageChain('pl'), ['pl', 'en', 'de']);
        assert.deepEqual(languageChain('de'), ['de', 'en']);
        assert.deepEqual(languageChain('EN-gb'), ['en', 'de']);
    });

    it('recognises generic API names', () => {
        for (const g of ['02-010', 'Knoten 15', 'Funktion 14-0', 'Function -1-32', '', 'node 3']) {
            assert.equal(isGenericName(g), true, g);
        }
        for (const n of ['Heizkreis 1', 'Boiler', 'Pufferspeicher']) {
            assert.equal(isGenericName(n), false, n);
        }
    });
});

describe('name resolution against the fake controller', () => {
    let fake: FakeController;
    beforeEach(async () => {
        const fixture = JSON.parse(JSON.stringify(gasBoilerFixture)) as typeof gasBoilerFixture;
        fixture.resources = {
            '/res/xml/EbenenTexte_en.xml': LEVELS_EN,
            '/res/xml/VarIdentTexte_en.xml': VARS_EN,
            '/res/xml/AufzaehlTexte_en.xml': ENUMS_EN,
            '/res/xml/VarIdentTexte_de.xml': VARS_DE_LATIN1,
        };
        fake = new FakeController(fixture);
        await fake.start();
    });
    afterEach(async () => fake.stop());

    it('resolves datapoint, group and enum names; ids stay OID-based', async () => {
        const c = makeClient(fake);
        const api = new InfoWinRestApi(c);
        const catalog = await scanSystem(api, { excludedNodes: new Set(), includeLon: false });
        const texts = await loadTextTables(c, 'pl');
        c.close();
        assert.equal(texts.language, 'en', 'pl missing -> falls back to en');
        applyLabels(catalog, texts);
        const idx = indexCatalog(catalog);
        const sp = idx.byOid.get(OID.hc1RoomSetpoint)!;
        assert.equal(sp.label, 'Heating circuit & room: Room temperature setpoint');
        assert.equal(sp.key, 's1.n16.f0.g3.m21.i0', 'identity is OID-based');
        const mode = idx.byOid.get(OID.hc1Mode)!;
        assert.equal(shapeFor(mode, false).states!['2'], 'Comfort');
        assert.equal(idx.groups.get('n16.f0.l3')!.label, 'Heating circuit & room');
        assert.equal(idx.groups.get('n15.f0.l3')!.label, 'Boiler');
        // No variable text: level name plus the controller code keeps it unique.
        assert.equal(idx.byOid.get(OID.noMetadata)!.label, 'Heating circuit & room (03-025)');
        assert.ok(
            fake.requests.every(r => r.method === 'GET'),
            'text loading is read-only',
        );
    });

    it('works without any text tables (older firmware)', async () => {
        fake.fixture.resources = {};
        const c = makeClient(fake);
        const texts = await loadTextTables(c, 'de');
        c.close();
        assert.equal(texts.variables.size, 0);
        assert.equal(texts.language, '');
    });
});
