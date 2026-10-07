import { expect, it } from 'vitest';
import { parseGpuQuery, checkCudaResources } from './gpu-resources.js';
import type { PlannerReport, RuntimeConfiguration } from './preflight.js';

const first = 'GPU-22c23971-dacf-2123-2169-ad70d8f6729a';
const second = 'GPU-32c23971-dacf-2123-2169-ad70d8f6729a';
const row = (
  uuid = first,
  free = '12',
  bus = '00000000:04:00.0',
  name = 'NVIDIA GeForce RTX 4060 Ti',
) => `${uuid}, ${bus}, 617.14, 16, ${free}, [N/A], WDDM, ${name}\n`;
it('keeps each detected GPU name attached to its own UUID and memory values', () => {
  const named = row() + row(second, '8', '00000000:05:00.0', 'NVIDIA GeForce RTX 3080');
  expect(parseGpuQuery(Buffer.from(named))).toMatchObject([
    { uuid: first, name: 'NVIDIA GeForce RTX 4060 Ti', total: 16 * 1048576, free: 12 * 1048576 },
    { uuid: second, name: 'NVIDIA GeForce RTX 3080', total: 16 * 1048576, free: 8 * 1048576 },
  ]);
});
const config: RuntimeConfiguration = {
  modelSha256: 'a'.repeat(64),
  contextPerSlot: 4096,
  slots: 2,
  gpuLayers: 20,
  cacheK: 'f16',
  cacheV: 'f16',
  seed: 7,
  temperature: 0.8,
};
const cacheRam = 768 * 1048576;
const report: PlannerReport = {
  artifact: 'cuda-1',
  backend: 'cuda',
  modelSha256: config.modelSha256,
  configuration: config,
  contextLimit: 8192,
  weights: { ram: 100, vram: 8 * 1048576 },
  kv: { ram: 40, vram: 1048576 },
  scratch: { ram: 10, vram: 1048576 },
  serverCaches: { promptCacheMiB: 768, contextCheckpoints: 2, ram: cacheRam },
  uncertainty: null,
  deviceVram: [{ uuid: first, bytes: 10 * 1048576 }],
};
const check = (
  change: Partial<PlannerReport> = {},
  output = row(),
  ram: number | null = cacheRam + 150,
  driver = '600.0',
) =>
  checkCudaResources(
    config,
    'cuda-1',
    { ...report, ...change },
    { ram, gpus: parseGpuQuery(Buffer.from(output)) },
    driver,
  );

it('binds explicit launch placement to exactly one matching physical allocation', () => {
  const selected = { ...config, gpuDevice: first };
  const selectedReport = { ...report, configuration: selected };
  const snapshot = {
    ram: cacheRam + 150,
    gpus: parseGpuQuery(Buffer.from(row() + row(second, '12', '00000000:05:00.0'))),
  };
  expect(checkCudaResources(selected, 'cuda-1', selectedReport, snapshot, '600.0').code).toBe(
    'ADMITTED',
  );
  expect(
    checkCudaResources(
      selected,
      'cuda-1',
      { ...selectedReport, deviceVram: [{ uuid: second, bytes: 10 * 1048576 }] },
      snapshot,
      '600.0',
    ).code,
  ).toBe('NEEDS_RESOURCE_EVIDENCE');
  expect(
    checkCudaResources(
      selected,
      'cuda-1',
      {
        ...selectedReport,
        deviceVram: [
          { uuid: first, bytes: 5 * 1048576 },
          { uuid: second, bytes: 5 * 1048576 },
        ],
      },
      snapshot,
      '600.0',
    ).code,
  ).toBe('NEEDS_RESOURCE_EVIDENCE');
});

it('reads physical devices, byte units and installed driver without creating a GPU context', () => {
  expect(parseGpuQuery(Buffer.from(row()))).toEqual([
    {
      uuid: first,
      name: 'NVIDIA GeForce RTX 4060 Ti',
      bus: '00000000:04:00.0',
      driver: '617.14',
      total: 16 * 1048576,
      free: 12 * 1048576,
      mig: '[N/A]',
      driverModel: 'WDDM',
    },
  ]);
  expect(parseGpuQuery(Buffer.alloc(0))).toEqual([]);
});
it('retains unknown memory as unknown rather than zero', () => {
  expect(parseGpuQuery(Buffer.from(row(first, '[N/A]')))[0]?.free).toBeNull();
  expect(check({}, row(first, '[N/A]')).code).toBe('NEEDS_RESOURCE_EVIDENCE');
});
it('keeps an unavailable GPU name unknown and rejects unbounded or malformed names', () => {
  expect(
    parseGpuQuery(Buffer.from(row(first, '12', '00000000:04:00.0', '[N/A]')))[0]?.name,
  ).toBeNull();
  for (const name of ['', 'x'.repeat(257), 'GPU\u0000name', 'GPU, extra field']) {
    expect(() => parseGpuQuery(Buffer.from(row(first, '12', '00000000:04:00.0', name)))).toThrow(
      'INVALID_GPU_QUERY',
    );
  }
});
it.each([
  row() + row(),
  row().replace('617.14', 'CUDA 12'),
  row().replace('16, 12', '16, 17'),
  row().replace('16, 12', '16, -1'),
  row().replace('16, 12', '16, 1.5'),
  row().replace('16, 12', '9007199254740991, 12'),
  row().replace('WDDM', 'unknown'),
  row().replace('[N/A]', 'Unknown'),
  row().replace(first, 'GPU-0'),
  row() + row(second, '12'),
  'warning\n' + row(),
  row().replace(', WDDM', ''),
])('rejects ambiguous or malformed discovery output', (output) => {
  expect(() => parseGpuQuery(Buffer.from(output))).toThrow('INVALID_GPU_QUERY');
});
it('rejects invalid UTF-8 and bounded-output violations', () => {
  expect(() => parseGpuQuery(Buffer.from([255]))).toThrow('INVALID_GPU_QUERY');
  expect(() => parseGpuQuery(Buffer.alloc(65537))).toThrow('INVALID_GPU_QUERY');
});
it('admits exact requirements and does not alter selected settings', () => {
  expect(check()).toMatchObject({
    code: 'ADMITTED',
    ram: cacheRam + 150,
    vram: 10 * 1048576,
    totalContext: 8192,
  });
  expect(config).toEqual(report.configuration);
});
it('rejects RAM and per-device VRAM shortage', () => {
  expect(check({}, row(), cacheRam + 149).code).toBe('INSUFFICIENT_RESOURCES');
  expect(check({}, row(first, '9')).code).toBe('INSUFFICIENT_RESOURCES');
});
it('cannot use a second GPU to hide shortage on the selected GPU', () => {
  expect(check({}, row(first, '9') + row(second, '16', '00000000:05:00.0')).code).toBe(
    'INSUFFICIENT_RESOURCES',
  );
});
it('checks both budgets when the validated report splits allocations across devices', () => {
  const deviceVram = [
    { uuid: first, bytes: 5 * 1048576 },
    { uuid: second, bytes: 5 * 1048576 },
  ];
  expect(check({ deviceVram }, row(first, '5') + row(second, '5', '00000000:05:00.0')).code).toBe(
    'ADMITTED',
  );
  expect(check({ deviceVram }, row(first, '12') + row(second, '4', '00000000:05:00.0')).code).toBe(
    'INSUFFICIENT_RESOURCES',
  );
});
it('requires exact non-duplicated device placement evidence', () => {
  for (const deviceVram of [
    [],
    [{ uuid: second, bytes: 10 * 1048576 }],
    [{ uuid: first, bytes: 1 }],
    [{ uuid: first, bytes: -1 }],
    [
      { uuid: first, bytes: 5 * 1048576 },
      { uuid: first, bytes: 5 * 1048576 },
    ],
  ]) {
    expect(check({ deviceVram }).code).toBe('NEEDS_RESOURCE_EVIDENCE');
  }
  const { deviceVram: _placement, ...aggregateOnly } = report;
  expect(_placement).toHaveLength(1);
  expect(
    checkCudaResources(
      config,
      'cuda-1',
      aggregateOnly,
      { ram: cacheRam + 150, gpus: parseGpuQuery(Buffer.from(row())) },
      '600.0',
    ).code,
  ).toBe('NEEDS_RESOURCE_EVIDENCE');
});
it('refuses unknown RAM, GPU discovery, MIG partitions and invalid driver evidence', () => {
  expect(check({}, row(), null).code).toBe('NEEDS_RESOURCE_EVIDENCE');
  expect(
    checkCudaResources(config, 'cuda-1', report, { ram: cacheRam + 150, gpus: null }, '600.0').code,
  ).toBe('NEEDS_RESOURCE_EVIDENCE');
  expect(check({}, row().replace('[N/A]', 'Enabled')).code).toBe('NEEDS_RESOURCE_EVIDENCE');
  expect(check({}, row(), cacheRam + 150, 'CUDA12').code).toBe('NEEDS_RESOURCE_EVIDENCE');
});
it('compares numeric driver versions rather than CUDA banners or lexical strings', () => {
  expect(check({}, row().replace('617.14', '99.99'), cacheRam + 150, '100.1').code).toBe(
    'INCOMPATIBLE_DRIVER',
  );
  expect(check({}, row(), cacheRam + 150, '617.14.0').code).toBe('ADMITTED');
});
it('retains model, build and configuration validation before GPU admission', () => {
  expect(check({ artifact: 'other' }).code).toBe('NEEDS_RESOURCE_EVIDENCE');
  expect(check({ uncertainty: 'unvalidated' }).code).toBe('NEEDS_RESOURCE_EVIDENCE');
  expect(check({ configuration: { ...config, contextPerSlot: 2048 } }).code).toBe(
    'NEEDS_RESOURCE_EVIDENCE',
  );
});
