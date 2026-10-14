import { expect, it } from 'vitest';
import { createConfigurationProfile } from './development-profile.js';
import { DEVELOPMENT_MEMORY_REPORTS } from '../runtime-package/development-policy.js';

it('derives defaults only from the exact pinned four-slot resource configuration', () => {
  const report = DEVELOPMENT_MEMORY_REPORTS.find((entry) => entry.configuration.slots === 4)!;
  const provenance = {
    packageId: 'llama-cuda-development',
    upstreamCommit: '4f31296a907d73f3409f720429bcf31111615d77',
    configuration: report.configuration,
  };
  const profile = createConfigurationProfile(provenance);
  expect(profile.load.contextLength).toBe(7680);
  expect(profile.load.concurrency).toBe(4);
  expect(profile.capabilities.nativeDefaults.seed).toBe(7);
  expect(profile.capabilities.maxOutputTokens).toBe(512);
  expect(profile.capabilities.thinking).toBe(false);
  expect(() =>
    createConfigurationProfile({
      ...provenance,
      configuration: { ...provenance.configuration, slots: 8 },
    }),
  ).toThrow('NEEDS_RESOURCE_EVIDENCE');
  expect(() =>
    createConfigurationProfile({ ...provenance, upstreamCommit: 'b'.repeat(40) }),
  ).toThrow('UNSUPPORTED_RUNTIME');
});
