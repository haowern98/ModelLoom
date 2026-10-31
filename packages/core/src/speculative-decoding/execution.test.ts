import { expect, it } from 'vitest';
import { executionDevices, speculativeArguments, verifySpeculativeStartup } from './execution.js';
import { resolveClusterLoad } from '../cluster/effective-load.js';
import { record } from '../model-configuration/test-fixtures.js';
import type { SavedClusterConfiguration } from '../cluster/contracts.js';

const a = 'GPU-11111111-1111-1111-1111-111111111111';
const b = 'GPU-22222222-2222-2222-2222-222222222222';
const remote = `peer:${'c'.repeat(64)}:${b}`;
function load(device = b, method: 'draft' | 'mtp' | 'dspark' = 'draft') {
  const saved: SavedClusterConfiguration = {
    id: '12345678-1234-4234-8234-123456789abc',
    name: 'Test',
    revision: 1,
    modelId: 'a'.repeat(64),
    blockCount: 64,
    profileId: 'b11306-four-slot',
    load: {
      defaults: record().load,
      cacheK: 'q8_0',
      cacheV: 'q8_0',
      speculation: {
        version: 1,
        enabled: true,
        proposer: { method, source: { kind: 'asset', modelId: 'b'.repeat(64) }, maxDraftTokens: 3 },
        retrieval: null,
      },
    },
    proposerDevice: device,
    runs: [{ uuid: a, first: 0, last: 63 }],
  };
  return resolveClusterLoad(saved, 'b11306-cuda12.4-msvc14.44-dev1');
}
it('reserves the deduplicated target and proposer device union with shared native ordinals', () => {
  expect(executionDevices(load())).toEqual([a, b]);
  expect(executionDevices(load(a))).toEqual([a]);
  expect(executionDevices(load('cpu'))).toEqual([a]);
  expect(executionDevices(load(remote))).toEqual([a, remote]);
  expect(speculativeArguments(load(), 'E:\\draft.gguf')).toEqual([
    '--spec-type',
    'draft-simple',
    '--spec-draft-model',
    'E:\\draft.gguf',
    '--spec-draft-device',
    'CUDA1',
    '--spec-draft-ngl',
    '999',
    '--spec-draft-n-max',
    '3',
    '--spec-draft-type-k',
    'q8_0',
    '--spec-draft-type-v',
    'q8_0',
  ]);
  expect(speculativeArguments(load(remote), 'E:\\draft.gguf')).toContain('RPC0');
  expect(speculativeArguments(load('cpu'), 'E:\\draft.gguf')).toContain('none');
});
it('requires explicit initialized speculation and rejects native fallback', () => {
  expect(() => verifySpeculativeStartup(load(), 'llama_server: model loaded\n')).toThrow(
    'SPECULATIVE_INITIALIZATION_FAILED',
  );
  expect(() =>
    verifySpeculativeStartup(load(), 'speculative decoding context initialized\n'),
  ).not.toThrow();
  expect(() =>
    verifySpeculativeStartup(
      load(),
      'failed to initialize speculative decoding context: invalid\nspeculative decoding context initialized\n',
    ),
  ).toThrow('SPECULATIVE_INITIALIZATION_FAILED');
});
it('rejects cross-device shared-weight heads before native creation', () => {
  const target = load();
  const head = {
    ...target,
    speculation: {
      ...target.speculation!,
      proposer: { ...target.speculation!.proposer!, method: 'dflash' as const },
    },
  };
  expect(() => speculativeArguments(head, 'E:\\head.gguf')).toThrow(
    'UNSUPPORTED_SPECULATIVE_DEVICE',
  );
  expect(() =>
    speculativeArguments({ ...head, proposerDevice: 'auto' }, 'E:\\head.gguf'),
  ).not.toThrow();
});
