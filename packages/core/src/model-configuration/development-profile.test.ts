import { expect, it } from 'vitest';
import { createConfigurationProfile } from './development-profile.js';
import { DEVELOPMENT_MEMORY_REPORTS } from '../runtime-package/development-policy.js';

const provenance = {
  packageId: 'llama-cuda-development',
  upstreamCommit: '4f31296a907d73f3409f720429bcf31111615d77',
  configuration: DEVELOPMENT_MEMORY_REPORTS.find((entry) => entry.configuration.slots === 4)!
    .configuration,
};
it('preserves native defaults while admitting other model hashes and load tuples', () => {
  const profile = createConfigurationProfile({
    ...provenance,
    configuration: {
      ...provenance.configuration,
      modelSha256: 'a'.repeat(64),
      slots: 8,
      contextPerSlot: 4096,
    },
  });
  expect(profile.load.contextLength).toBe(4096);
  expect(profile.load.concurrency).toBe(8);
  expect(profile.capabilities.nativeDefaults.seed).toBe(7);
  expect(profile.capabilities.maxOutputTokens).toBe(2147483647);
  expect(profile.capabilities.contextLimit).toBe(2147483647);
});
it('uses optional model context and thinking metadata', () => {
  const profile = createConfigurationProfile(provenance, {
    contextLimit: 4096,
    thinkingSupported: false,
  });
  expect(profile.load.contextLength).toBe(4096);
  expect(profile.capabilities.contextLimit).toBe(4096);
  expect(profile.capabilities.thinking).toBe(false);
  expect(
    createConfigurationProfile(provenance, { contextLimit: 32768, thinkingSupported: true })
      .capabilities.thinking,
  ).toBe(true);
});
it('still rejects unapproved runtime versions and packages', () => {
  expect(() =>
    createConfigurationProfile({ ...provenance, upstreamCommit: 'b'.repeat(40) }),
  ).toThrow('UNSUPPORTED_RUNTIME');
  expect(() => createConfigurationProfile({ ...provenance, packageId: 'other-package' })).toThrow(
    'NEEDS_RESOURCE_EVIDENCE',
  );
});
