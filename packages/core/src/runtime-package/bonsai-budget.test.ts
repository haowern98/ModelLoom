import { expect, it } from 'vitest';
import { DEVELOPMENT_MEMORY_REPORTS } from './development-policy.js';
import { APPROVED_MEMORY_REPORTS } from './trust-policy.js';
import { checkResources } from '../runtime/preflight.js';
it('provisions only the exact development Bonsai configuration with a cache-inclusive budget', () => {
  expect(APPROVED_MEMORY_REPORTS).toEqual([]);
  expect(DEVELOPMENT_MEMORY_REPORTS).toHaveLength(1);
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
