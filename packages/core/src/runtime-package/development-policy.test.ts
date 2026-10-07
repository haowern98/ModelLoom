import { expect, it, vi, afterEach } from 'vitest';
const root = {
  asset: 'development-root.json',
  sha256: 'fa142094d12daccc01f8888051e97b6366d43c71f4e18583fa69c91734969f15',
};
afterEach(() => {
  vi.resetModules();
  vi.doUnmock('./development-policy.js');
  vi.doUnmock('./trust-policy.js');
});
it('pins development trust only in an explicit build and rejects it as production trust', async () => {
  vi.doMock('./development-policy.js', () => ({ DEVELOPMENT_BUILD: true, DEVELOPMENT_ROOT: root }));
  vi.doMock('./trust-policy.js', () => ({
    APPROVED_RUNTIME_ROOTS: [root],
    APPROVED_MEMORY_REPORTS: [],
  }));
  const { createRuntimeVerifier, createDevelopmentRuntimeVerifier, requireLivePackage } =
    await import('./verifier.js');
  expect(() => createRuntimeVerifier()).toThrow('INVALID_TRUST_ROOT');
  expect(() => createDevelopmentRuntimeVerifier()).not.toThrow();
  expect(() => requireLivePackage({ packageId: 'forged' })).toThrow('UNVERIFIED_PACKAGE');
});
it('rejects an altered public-root pin before accepting development metadata', async () => {
  vi.doMock('./development-policy.js', () => ({
    DEVELOPMENT_BUILD: true,
    DEVELOPMENT_ROOT: { ...root, sha256: '0'.repeat(64) },
  }));
  const { createDevelopmentRuntimeVerifier } = await import('./verifier.js');
  expect(() => createDevelopmentRuntimeVerifier()).toThrow('INVALID_TRUST_ROOT');
});
