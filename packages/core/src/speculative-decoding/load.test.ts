import { expect, it } from 'vitest';
import { resolveClusterLoad } from '../cluster/effective-load.js';
import { decodeSavedClusterConfiguration } from '../cluster/contracts.js';
import { requireStockClusterProfile, createStockClusterReport } from '../cluster/stock-profile.js';
import { parseClusterEstimate } from '../cluster/estimate.js';
import { record } from '../model-configuration/test-fixtures.js';
import { speculationOff } from './contracts.js';

const saved = decodeSavedClusterConfiguration({
  id: '12345678-1234-4234-8234-123456789abc',
  name: 'Target',
  revision: 1,
  modelId: 'a'.repeat(64),
  profileId: 'b11306-four-slot',
  blockCount: 64,
  load: { defaults: record().load, cacheK: 'q8_0', cacheV: 'q8_0' },
  runs: [{ uuid: 'GPU-11111111-1111-1111-1111-111111111111', first: 0, last: 63 }],
});
const artifact = 'b11306-cuda12.4-msvc14.44-dev1';
it('captures speculation and proposer placement in the effective load identity', () => {
  const initial = resolveClusterLoad(saved, artifact);
  const speculation = {
    ...speculationOff(),
    enabled: true,
    proposer: {
      method: 'mtp' as const,
      source: { kind: 'embedded' as const },
      maxDraftTokens: 3,
    },
  };
  const requested = { ...saved, load: { ...saved.load, speculation } };
  const cpu = resolveClusterLoad({ ...requested, proposerDevice: 'cpu' }, artifact);
  const gpu = resolveClusterLoad({ ...requested, proposerDevice: saved.runs[0]!.uuid }, artifact);
  expect(cpu.speculation).toEqual(speculation);
  expect(new Set([initial.fingerprint, cpu.fingerprint, gpu.fingerprint]).size).toBe(3);
  expect(() => parseClusterEstimate(Buffer.from('CUDA0 1 1 1\nHost 1 1 1'), cpu)).toThrow(
    'INVALID_ESTIMATE',
  );
  expect(() => requireStockClusterProfile(initial)).not.toThrow();
});
it('admits only qualified combined estimates including a proposer-only GPU', () => {
  const spec = {
    ...speculationOff(),
    enabled: true,
    proposer: {
      method: 'draft' as const,
      source: { kind: 'asset' as const, modelId: 'b'.repeat(64) },
      maxDraftTokens: 3,
    },
  };
  const load = resolveClusterLoad(
    {
      ...saved,
      proposerDevice: 'GPU-22222222-2222-2222-2222-222222222222',
      load: { ...saved.load, speculation: spec },
    },
    artifact,
  );
  const qualification = {
    version: 1,
    method: 'draft-simple',
    initialized: true,
    sourceCommit: '4f31296a907d73f3409f720429bcf31111615d77',
    hostExtraBytes: 1024,
    hostBounded: true,
    targetLayers: 64,
    targetHidden: 5120,
    targetContext: 30720,
    targetVocab: 248320,
  };
  const parse = (q: unknown) =>
    parseClusterEstimate(
      Buffer.from(
        `MODELLOOM_SPEC_ESTIMATE ${JSON.stringify(q)}\nCUDA0 1 2 3\nCUDA1 4 5 6\nHost 7 8 9`,
      ),
      load,
    );
  expect(() => parse({ ...qualification, initialized: false })).toThrow();
  expect(() => parse({ ...qualification, method: 'draft-mtp' })).toThrow();
  const estimate = parse(qualification);
  expect(estimate.devices).toHaveLength(2);
  expect(estimate.host.compute).toBe(10 * 1048576);
  expect(() => createStockClusterReport(load, estimate)).toThrow('NEEDS_SPECULATIVE_EVIDENCE');
  const report = createStockClusterReport(load, estimate, 0, {
    modelId: 'b'.repeat(64),
    file: 'E:\\draft.gguf',
    sizeBytes: 1,
    modifiedMs: 1,
  });
  expect(report.devices).toHaveLength(2);
});
