import { expect, it } from 'vitest';
import { resolveClusterLoad } from './effective-load.js';
import type { ClusterEffectiveLoad } from './effective-load.js';
import { parseClusterEstimate } from './estimate.js';
import { record } from '../model-configuration/test-fixtures.js';
import {
  requireStockClusterProfile,
  createStockClusterReport,
  checkStockClusterResources,
} from './stock-profile.js';
const uuid = 'GPU-12345678-1234-1234-1234-123456789abc';
const load = resolveClusterLoad(
  {
    id: '12345678-1234-4234-8234-123456789abc',
    name: 'Test',
    revision: 1,
    modelId: '71d6871836886267f39f1ac69b1b1dd8a783970708d7a189960112ed02978901',
    profileId: 'b11306-four-slot',
    blockCount: 64,
    load: { defaults: record().load, cacheK: 'q8_0', cacheV: 'q8_0' },
    runs: [{ uuid, first: 0, last: 63 }],
  },
  'b11306-cuda12.4-msvc14.44-dev1',
);
const estimate = () => parseClusterEstimate(Buffer.from('CUDA0 100 20 30\nHost 10 0 2'), load);
const snapshot = (free = 1024 ** 3) => ({
  ram: 16 * 1024 ** 3,
  gpus: [
    {
      uuid,
      bus: '00000000:01:00.0',
      driver: '617.14',
      total: 1024 ** 3,
      free,
      mig: 'Disabled' as const,
      driverModel: 'WDDM' as const,
    },
  ],
});
it('accepts compatible model identities and supported load settings', () => {
  expect(requireStockClusterProfile(load).cacheLayers).toEqual(Array(64).fill('auto'));
  const other = {
    ...load,
    modelSha256: 'f'.repeat(64),
    blockCount: 65,
    contextPerSlot: 2048,
    slots: 2,
    threads: 6,
    batch: 1024,
    microbatch: 256,
    flashAttention: false,
    cacheK: 'f16' as const,
    cacheV: 'f16' as const,
  };
  expect(requireStockClusterProfile(other).cacheLayers).toHaveLength(65);
  for (const change of [
    { slots: 0 },
    { blockCount: 0 },
    { modelSha256: 'invalid' },
    { artifact: 'other' },
    { serverCaches: { promptCacheMiB: 0, contextCheckpoints: 2 } },
  ])
    expect(() =>
      requireStockClusterProfile({ ...load, ...change } as unknown as ClusterEffectiveLoad),
    ).toThrow('NEEDS_RESOURCE_EVIDENCE');
});
it('uses rounded components with conservative margins and rejects mismatched estimates', () => {
  const report = createStockClusterReport(load, estimate());
  expect(report.devices[0]?.bytes).toBe(Math.ceil(153 * 1048576 * 1.15) + 256 * 1048576);
  expect(report.hostBytes).toBeGreaterThanOrEqual(12 * 1048576);
  expect(() => createStockClusterReport(load, { ...estimate(), fingerprint: 'wrong' })).toThrow(
    'NEEDS_RESOURCE_EVIDENCE',
  );
  expect(() =>
    createStockClusterReport(load, {
      ...estimate(),
      devices: [{ ...estimate().devices[0]!, model: NaN }],
    }),
  ).toThrow('NEEDS_RESOURCE_EVIDENCE');
});
it('requires a branded report and freshly sufficient resources', () => {
  const report = createStockClusterReport(load, estimate());
  expect(checkStockClusterResources(load, report, snapshot()).code).toBe('ADMITTED');
  expect(checkStockClusterResources(load, { ...report }, snapshot()).code).toBe(
    'NEEDS_RESOURCE_EVIDENCE',
  );
  expect(
    checkStockClusterResources(
      { ...load, placement: { ...load.placement, tensorSplit: [2] } },
      report,
      snapshot(),
    ).code,
  ).toBe('NEEDS_RESOURCE_EVIDENCE');
  expect(
    checkStockClusterResources(load, report, { ...snapshot(), ram: report.hostBytes }).code,
  ).toBe('SHARED_GPU_MEMORY_CONFIRMATION');
  expect(checkStockClusterResources(load, report, { ...snapshot(), ram: 0 }, true).code).toBe(
    'ADMITTED',
  );
  expect(
    checkStockClusterResources(load, report, {
      ...snapshot(),
      gpus: [{ ...snapshot().gpus[0]!, driver: '551.77' }],
    }).code,
  ).toBe('INCOMPATIBLE_DRIVER');
  expect(
    checkStockClusterResources(load, report, {
      ...snapshot(),
      gpus: [{ ...snapshot().gpus[0]!, mig: 'Enabled' }],
    }).code,
  ).toBe('INSUFFICIENT_RESOURCES');
});
it('warns for memory shortages and honors explicit consent', () => {
  const report = createStockClusterReport(load, estimate());
  expect(checkStockClusterResources(load, report, snapshot(0)).code).toBe(
    'SHARED_GPU_MEMORY_CONFIRMATION',
  );
  expect(checkStockClusterResources(load, report, snapshot(0), true)).toEqual({
    code: 'ADMITTED',
    sharedMemoryBytes: report.devices[0]!.bytes,
  });
  expect(
    checkStockClusterResources(
      load,
      report,
      { ...snapshot(0), ram: report.hostBytes + 1536 * 1048576 },
      true,
    ).code,
  ).toBe('ADMITTED');
});
it('permits confirmed shortages on multiple selected TCC GPUs without relaxing identity', () => {
  const second = 'GPU-22222222-2222-2222-2222-222222222222';
  const dual = {
    ...load,
    placement: { orderedUuids: [uuid, second], tensorSplit: [0.5, 0.5], outputUuid: second },
  };
  const report = createStockClusterReport(
    dual,
    parseClusterEstimate(Buffer.from('CUDA0 100 20 30\nCUDA1 100 20 30\nHost 10 0 2'), dual),
  );
  const low = {
    ram: 0,
    gpus: [uuid, second].map((id) => ({
      ...snapshot(0).gpus[0]!,
      uuid: id,
      driverModel: 'TCC' as const,
    })),
  };
  expect(checkStockClusterResources(dual, report, low).code).toBe('SHARED_GPU_MEMORY_CONFIRMATION');
  expect(checkStockClusterResources(dual, report, low, true).code).toBe('ADMITTED');
  expect(
    checkStockClusterResources(dual, report, { ...low, gpus: low.gpus.slice(0, 1) }, true).code,
  ).toBe('NEEDS_RESOURCE_EVIDENCE');
  expect(checkStockClusterResources(dual, { ...report }, low, true).code).toBe(
    'NEEDS_RESOURCE_EVIDENCE',
  );
});
it('marks extra NextN allocation blocks as having no ordinary inference cache', () => {
  const qwen = { ...load, modelSha256: 'f'.repeat(64), blockCount: 65 };
  const qwenEstimate = parseClusterEstimate(Buffer.from('CUDA0 100 20 30\nHost 10 0 2'), qwen);
  const report = createStockClusterReport(qwen, qwenEstimate, 1);
  expect(report.cacheLayers).toEqual([...Array.from({ length: 64 }, () => 'auto'), 'none']);
});
