"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CATALOG_SCHEMA_VERSION = void 0;
exports.scanFingerprint = scanFingerprint;
exports.moduleSignature = moduleSignature;
function scanFingerprint(options) {
    return {
        excludedNodes: [...options.excludedNodes].sort((a, b) => a - b),
        includeLon: options.includeLon,
        language: options.language ?? '',
    };
}
exports.CATALOG_SCHEMA_VERSION = 4;
function moduleSignature(modules) {
    return modules
        .map(m => `${m.nodeId}:${m.programId}:${m.neuronId}`)
        .sort()
        .join('|');
}
