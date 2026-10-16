import { expect, it } from 'vitest';
import { validatePlacementReceipt } from './placement-receipt.js';
import { checkClusterResources } from './evidence-profile.js';
import { resolveClusterLoad } from './effective-load.js';
import { record } from '../model-configuration/test-fixtures.js';
import { captureClusterRun } from './run-plan.js';
const uuid = 'GPU-12345678-1234-1234-1234-123456789abc';
const load = resolveClusterLoad(
  {
    id: '12345678-1234-4234-8234-123456789abc',
    name: 'Model',
    revision: 1,
    modelId: record().modelId,
    profileId: 'test',
    blockCount: 2,
    load: { defaults: record().load, cacheK: 'q8_0', cacheV: 'q8_0' },
    runs: [{ uuid, first: 0, last: 1 }],
  },
  'test',
);
const receipt = {
  version: 1,
  pid: 123,
  artifact: 'test',
  modelSha256: load.modelSha256,
  fingerprint: load.fingerprint,
  orderedUuids: [uuid],
  inputDevice: 'cpu',
  fallback: false,
  blocks: [0, 1].map((index) => ({
    index,
    deviceUuid: uuid,
    tensorDevices: [uuid],
    cacheDeviceUuid: uuid,
    executedDeviceUuid: uuid,
  })),
  output: { deviceUuid: uuid, tensorDevices: [uuid], executedDeviceUuid: uuid },
};
it('requires process-bound actual tensor, cache and output ownership', () => {
  expect(validatePlacementReceipt(Buffer.from(JSON.stringify(receipt)), load, 123)).toBe(true);
  for (const bad of [
    { ...receipt, pid: 124 },
    { ...receipt, fallback: true },
    { ...receipt, blocks: [...receipt.blocks, { ...receipt.blocks[0], index: 0 }] },
    { ...receipt, output: { ...receipt.output, tensorDevices: ['cpu'] } },
    { ...receipt, blocks: receipt.blocks.map((b) => ({ ...b, cacheDeviceUuid: 'cpu' })) },
  ])
    expect(() => validatePlacementReceipt(Buffer.from(JSON.stringify(bad)), load, 123)).toThrow(
      'PLACEMENT_MISMATCH',
    );
});
it('does not admit a raw estimate or a saved record as an independently approved profile', () => {
  expect(
    checkClusterResources(load, undefined, { ram: 32 * 2 ** 30, gpus: [] }, '546.01').code,
  ).toBe('NEEDS_RESOURCE_EVIDENCE');
});
it('requires a saved revision and rejects newer raw edits before preparing a run', () => {
  const saved = {
    id: '12345678-1234-4234-8234-123456789abc',
    name: 'Model',
    revision: 1,
    modelId: record().modelId,
    profileId: 'test',
    blockCount: 2,
    load: { defaults: record().load, cacheK: 'q8_0' as const, cacheV: 'q8_0' as const },
    runs: [{ uuid, first: 0, last: 1 }],
  };
  expect(() => captureClusterRun(saved, 2, null, 'test')).toThrow('STALE_CONFIGURATION');
  expect(() =>
    captureClusterRun(
      saved,
      1,
      {
        key: `config:${saved.id}`,
        configurationId: saved.id,
        modelId: saved.modelId,
        revision: 2,
        baseSavedRevision: 1,
        load: saved.load,
        runs: [{ uuid, first: '0', last: '-' }],
      },
      'test',
    ),
  ).toThrow('UNSAVED_CONFIGURATION');
  expect(captureClusterRun(saved, 1, null, 'test').fingerprint).toBe(load.fingerprint);
});
it('does not treat reverse GPU row order as an unsaved layer change', () => {
  const other = 'GPU-87654321-1234-1234-1234-123456789abc';
  const saved = {
    id: '12345678-1234-4234-8234-123456789abc',
    name: 'Model',
    revision: 1,
    modelId: record().modelId,
    profileId: 'test',
    blockCount: 2,
    load: { defaults: record().load, cacheK: 'q8_0' as const, cacheV: 'q8_0' as const },
    runs: [
      { uuid, first: 0, last: 0 },
      { uuid: other, first: 1, last: 1 },
    ],
  };
  const draft = {
    key: `config:${saved.id}`,
    configurationId: saved.id,
    modelId: saved.modelId,
    revision: 2,
    baseSavedRevision: 1,
    load: saved.load,
    runs: [
      { uuid: other, first: '1', last: '1' },
      { uuid, first: '0', last: '0' },
    ],
  };
  expect(captureClusterRun(saved, 1, draft, 'test').placement.orderedUuids).toEqual([uuid, other]);
});
