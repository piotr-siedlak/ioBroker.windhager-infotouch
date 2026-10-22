import type { Fixture } from '../helpers/FakeController';

/**
 * SYNTHETIC fixture. Field names follow the response shapes recorded by community projects (see RESEARCH.md);
 * all values, names and identifiers are invented. It does NOT represent a verified real device.
 * Layout: a "gas boiler with two heating circuits, a buffer and DHW" style installation, plus awkward cases
 * (duplicate display names, missing metadata, placeholder values, locked function, OID-less entry,
 * paging, LON variables, a time-program object, one module whose function list fails).
 */
const dp = (oid: string, name: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    OID: oid,
    name,
    value: '0',
    unit: '',
    typeId: 0,
    subtypeId: 0,
    groupNr: -1,
    memberNr: -1,
    minValue: '0',
    maxValue: '0',
    step: '1',
    stepId: 0,
    writeProt: true,
    ...extra,
});

export const OID = {
    boilerTemp: '/1/15/0/3/10/0',
    boilerSetpoint: '/1/15/0/3/11/0',
    hc1Mode: '/1/16/0/3/20/0',
    hc1RoomSetpoint: '/1/16/0/3/21/0',
    hc1Flow: '/1/16/0/3/22/0',
    hc1FlowDuplicate: '/1/16/0/3/23/0',
    placeholder: '/1/16/0/3/24/0',
    noMetadata: '/1/16/0/3/25/0',
    hc1Program: '/1/16/0/4/61/0',
    bufferTop: '/1/17/0/3/30/0',
} as const;

export const gasBoilerFixture: Fixture = {
    deviceinfo: [{ device: 'MB66xx', version: '1.0.2' }],
    lookups: {
        '/1': [
            {
                nodeId: 15,
                name: 'Boiler',
                group: '4',
                subnet: 1,
                programId: '0000001c01000000',
                neuronId: 'N000000015',
            },
            {
                nodeId: 16,
                name: 'Heating circuit',
                group: '4',
                subnet: 1,
                programId: '0000001c02000000',
                neuronId: 'N000000016',
            },
            {
                nodeId: 17,
                name: 'Buffer',
                group: '4',
                subnet: 1,
                programId: '0000001c03000000',
                neuronId: 'N000000017',
            },
            { nodeId: 99, name: 'Broken module', group: '4', subnet: 1, programId: 'ff', neuronId: 'N000000099' },
        ],
        '/1/15': {
            functions: [
                { fctId: 0, fctType: 1, name: 'Boiler', lock: false },
                { fctId: 32, fctType: -1, name: 'Service', lock: true },
            ],
        },
        '/1/16': { functions: [{ fctId: 0, fctType: 14, name: 'HC 1', lock: false }] },
        '/1/17': { functions: [{ fctId: 0, fctType: 5, name: 'Buffer', lock: false }] },
        '/1/99': 500,
        '/1/15/0': [{ id: 3, count: 2 }],
        '/1/16/0': [
            { id: 3, count: 6 },
            { id: 4, count: 1 },
        ],
        '/1/17/0': [
            { id: 3, count: 12 },
            { id: 9, count: 2 },
        ],
        '/1/15/0/3': [
            dp(OID.boilerTemp, 'Boiler temperature', {
                value: '64.5',
                unit: '°C',
                minValue: '0',
                maxValue: '110',
                step: '0.1',
            }),
            dp(OID.boilerSetpoint, 'Boiler setpoint', {
                value: '70',
                unit: '°C',
                minValue: '40',
                maxValue: '85',
                step: '1',
                writeProt: false,
            }),
        ],
        '/1/16/0/3': [
            dp(OID.hc1Mode, 'Operating mode', { value: '1', enum: '[0,1,2,3]', writeProt: false }),
            dp(OID.hc1RoomSetpoint, 'Room setpoint', {
                value: '21',
                unit: '°C',
                minValue: '10',
                maxValue: '30',
                step: '0.5',
                writeProt: false,
            }),
            dp(OID.hc1Flow, 'Flow temperature', {
                value: '38.2',
                unit: '°C',
                minValue: '0',
                maxValue: '120',
                step: '0.1',
            }),
            // Same display name as the previous entry: identity must come from the OID.
            dp(OID.hc1FlowDuplicate, 'Flow temperature', { value: '37.9', unit: '°C', step: '0.1' }),
            dp(OID.placeholder, 'Not connected sensor', { value: '-', unit: '°C' }),
            { OID: OID.noMetadata, value: '5' },
        ],
        '/1/16/0/4': [dp(OID.hc1Program, 'Heating program', { typeId: 30, value: '' })],
        '/1/17/0/3': [
            dp(OID.bufferTop, 'Buffer top', { value: '55.1', unit: '°C', step: '0.1' }),
            ...Array.from({ length: 9 }, (_, i) =>
                dp(`/1/17/0/3/${40 + i}/0`, `Counter ${i}`, { value: String(i), unit: 'h' }),
            ),
        ],
        '/1/17/0/9': [
            { nvName: 'nvoBufferTemp', nvIndex: 4, snvtName: 'SNVT_temp_p', snvtIndex: 105, value: '-', unit: '' },
            { nvName: 'nviUnknown', nvIndex: 5, snvtName: 'SNVT_unknown', snvtIndex: 999, value: '-' },
            { name: 'Header without OID', memberNr: 3 },
        ],
        '/1/17/0/9/4': {
            nvName: 'nvoBufferTemp',
            nvIndex: 4,
            snvtName: 'SNVT_temp_p',
            snvtIndex: 105,
            value: '55.1',
            unit: '°C',
        },
        '/1/17/0/9/5': { nvName: 'nviUnknown', nvIndex: 5, snvtName: 'SNVT_unknown', snvtIndex: 999, value: '1234' },
    },
    paged: {
        '/1/17/0/3': {
            10: [
                dp('/1/17/0/3/50/0', 'Counter 9', { value: '9', unit: 'h' }),
                dp('/1/17/0/3/51/0', 'Counter 10', { value: '10', unit: 'h' }),
            ],
        },
    },
    objects: {
        [OID.hc1Program]: {
            OID: OID.hc1Program,
            typeId: 30,
            value: { switchPoints: [{ time: '06:00', value: 1 }], weekdays: [1, 2, 3, 4, 5] },
        },
    },
};

export const emptyFixture: Fixture = {
    deviceinfo: [{ device: 'MB66xx', version: '1.0.2' }],
    lookups: { '/1': [] },
};
