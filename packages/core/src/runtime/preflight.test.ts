import { expect, it } from 'vitest';
import { checkResources } from './preflight.js';
import type { PlannerReport, RuntimeConfiguration } from './preflight.js';
const config: RuntimeConfiguration = Object.freeze({
  modelSha256: 'a'.repeat(64),
  contextPerSlot: 4096,
  slots: 2,
  gpuLayers: 0,
  cacheK: 'f16',
  cacheV: 'f16',
  seed: 7,
  temperature: 0.8,
});
const report: PlannerReport = {
  artifact: 'cpu-1',
  backend: 'cpu',
  modelSha256: config.modelSha256,
  configuration: config,
  contextLimit: 8192,
  weights: { ram: 100, vram: 0 },
  kv: { ram: 40, vram: 0 },
  scratch: { ram: 10, vram: 0 },
  uncertainty: null,
};
it('checks aggregate resources while retaining per-slot context and exact settings', () => {
  expect(checkResources(config, 'cpu-1', 'cpu', report, { ram: 150, vram: 0 })).toEqual({
    code: 'ADMITTED',
    totalContext: 8192,
    ram: 150,
    vram: 0,
  });
  expect(config.temperature).toBe(0.8);
  expect(config.contextPerSlot).toBe(4096);
});
it('refuses unknown requirements instead of calculating them from file size', () => {
  expect(
    checkResources(config, 'cpu-1', 'cpu', undefined, { ram: 10 ** 12, vram: 10 ** 12 }).code,
  ).toBe('NEEDS_RESOURCE_EVIDENCE');
});
it.each([
  { ram: 149, vram: 0 },
  { ram: 0, vram: 100000 },
])('refuses shortage %j without moving resources', (available) => {
  expect(checkResources(config, 'cpu-1', 'cpu', report, available).code).toBe(
    'INSUFFICIENT_RESOURCES',
  );
});
it.each([
  { artifact: 'other' },
  { backend: 'cuda' },
  { modelSha256: 'b'.repeat(64) },
  { uncertainty: 'unvalidated scratch' },
  { configuration: { ...config, cacheK: 'q8_0' } },
  { scratch: { ram: -1, vram: 0 } },
])('refuses mismatched or unvalidated planner %j', (change) => {
  expect(
    checkResources(config, 'cpu-1', 'cpu', { ...report, ...change } as PlannerReport, {
      ram: 999,
      vram: 999,
    }).code,
  ).toBe('NEEDS_RESOURCE_EVIDENCE');
});
it.each([
  { slots: 0 },
  { slots: Number.MAX_SAFE_INTEGER },
  { contextPerSlot: 8193 },
  { gpuLayers: -1 },
  { temperature: NaN },
])('refuses unsupported or overflowing configuration %j', (change) => {
  expect(
    checkResources({ ...config, ...change }, 'cpu-1', 'cpu', report, { ram: 999, vram: 0 }).code,
  ).toBe('INVALID_CONFIGURATION');
});
