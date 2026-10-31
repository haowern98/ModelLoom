import { expect, it } from 'vitest';
import { decodeSpeculativeDefaults, speculationOff } from './contracts.js';
import { decodeModelConfiguration } from '../model-configuration/contracts.js';
import { capabilities, record } from '../model-configuration/test-fixtures.js';

const draft = {
  version: 1,
  enabled: true,
  proposer: {
    method: 'draft',
    source: { kind: 'asset', modelId: 'b'.repeat(64) },
    maxDraftTokens: 3,
  },
  retrieval: null,
};

it('migrates v1 records to speculation Off without changing existing settings', () => {
  const legacy = record();
  const decoded = decodeModelConfiguration(legacy, capabilities);
  expect(decoded).toEqual({ ...legacy, schemaVersion: 2, speculation: speculationOff() });
  expect(decodeModelConfiguration(decoded, capabilities)).toEqual(decoded);
});

it('retains bounded disabled selections and accepts one neural and one retrieval method', () => {
  expect(decodeSpeculativeDefaults(draft)).toEqual(draft);
  const retained = { ...draft, enabled: false, retrieval: { method: 'ngram-simple' } };
  expect(decodeSpeculativeDefaults(retained)).toEqual(retained);
  expect(Object.isFrozen(decodeSpeculativeDefaults(draft).proposer?.source)).toBe(true);
});

it.each([
  { ...draft, arguments: '--model evil' },
  { ...draft, proposer: null },
  { ...draft, proposer: { ...draft.proposer, source: null } },
  { ...draft, proposer: { ...draft.proposer, source: { kind: 'embedded' } } },
  { ...draft, proposer: { ...draft.proposer, maxDraftTokens: 0 } },
  { ...draft, proposer: { ...draft.proposer, maxDraftTokens: 257 } },
  { ...draft, proposer: { ...draft.proposer, source: { kind: 'asset', modelId: '../file' } } },
  { ...draft, retrieval: { method: 'custom-suffix' } },
  { ...draft, proposer: { ...draft.proposer, device: 'CUDA0' } },
])('rejects malformed or untrusted speculative selections %#', (input) => {
  expect(() => decodeSpeculativeDefaults(input)).toThrow('INVALID_CONFIGURATION');
});

it('rejects a v2 record with missing or unknown speculative fields', () => {
  expect(() => decodeModelConfiguration({ ...record(), schemaVersion: 2 }, capabilities)).toThrow();
  expect(() =>
    decodeModelConfiguration({ ...record(), schemaVersion: 1, speculation: draft }, capabilities),
  ).toThrow();
});
