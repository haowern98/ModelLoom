import { expect, it } from 'vitest';
import { DEVELOPMENT_MEMORY_REPORTS } from './development-policy.js';
import { APPROVED_MEMORY_REPORTS } from './trust-policy.js';
import { checkResources } from '../runtime/preflight.js';
it('provisions only the exact development Bonsai configuration with a cache-inclusive budget', () => {
  expect(APPROVED_MEMORY_REPORTS).toEqual([]);
  expect(DEVELOPMENT_MEMORY_REPORTS).toHaveLength(2);
  const report = DEVELOPMENT_MEMORY_REPORTS[0]!;
  expect(report.configuration.contextPerSlot).toBe(7680);
  expect(report.configuration.slots).toBe(1);
  expect(report.configuration.cacheV).toBe('q8_0');
  expect(report.serverCaches).toMatchObject({ promptCacheMiB: 768, contextCheckpoints: 2 });
  const result = checkResources(report.configuration, report.artifact, report.backend, report, {
    ram: 10 * 2 ** 30,
    vram: 16 * 2 ** 30,
  });
  expect(result.code).toBe('ADMITTED');
  expect(result.ram).toBe(6618 * 1048576);
  expect(
    checkResources(report.configuration, report.artifact, report.backend, report, {
      ram: result.ram! - 1,
      vram: 16 * 2 ** 30,
    }).code,
  ).toBe('INSUFFICIENT_RESOURCES');
  expect(
    checkResources(
      { ...report.configuration, contextPerSlot: 8192 },
      report.artifact,
      report.backend,
      report,
      { ram: 10 * 2 ** 30, vram: 16 * 2 ** 30 },
    ).code,
  ).toBe('NEEDS_RESOURCE_EVIDENCE');
});
it('admits four unchanged slots only when both physical RAM and GPU budgets fit', () => {
  const report = DEVELOPMENT_MEMORY_REPORTS.find((entry) => entry.configuration.slots === 4);
  expect(report).toBeDefined();
  if (!report) throw new Error('MISSING_FOUR_SLOT_REPORT');
  const available = { ram: 6500 * 1048576, vram: 5579 * 1048576 };
  // The retained four-slot resident peak includes exercised checkpoints and prompt reuse.
  expect(available.ram).toBeGreaterThanOrEqual(6210097152 + 512 * 1048576);
  expect(report.serverCaches).toEqual({
    promptCacheMiB: 768,
    contextCheckpoints: 2,
    ram: (768 + 4 * 2 * 151 + 256) * 1048576,
  });
  expect(
    checkResources(report.configuration, report.artifact, 'cuda', report, available),
  ).toMatchObject({
    code: 'ADMITTED',
    totalContext: 30720,
    ...available,
  });
  for (const shortage of [
    { ...available, ram: available.ram - 1 },
    { ...available, vram: available.vram - 1 },
  ])
    expect(
      checkResources(report.configuration, report.artifact, 'cuda', report, shortage).code,
    ).toBe('INSUFFICIENT_RESOURCES');
  expect(
    checkResources(
      { ...report.configuration, cacheV: 'f16' },
      report.artifact,
      'cuda',
      report,
      available,
    ).code,
  ).toBe('NEEDS_RESOURCE_EVIDENCE');
});
