import { describe, expect, it } from 'vitest';
import { qualifyPeerGpu } from '../cluster/device-id.js';
import type { ClusterEffectiveLoad } from '../cluster/effective-load.js';
import { compilePlacement } from '../cluster/placement.js';
import { requireStockClusterProfile } from '../cluster/stock-profile.js';
import { SERVER_CACHE_POLICY } from '../runtime/preflight.js';
import { admitsDevelopmentB11307, B11307_DEVELOPMENT } from './development-b11307.js';

const local = 'GPU-22c23971-dacf-2123-2169-ad70d8f6729a';
const worker = qualifyPeerGpu('f'.repeat(64), 'GPU-d42a520b-020b-2673-9923-6906e674e243');
const single = compilePlacement([{ uuid: local, first: 0, last: 63 }], 64);
const split = (workerFirst: number) =>
  compilePlacement(
    [
      { uuid: local, first: 0, last: workerFirst - 1 },
      { uuid: worker, first: workerFirst, last: 63 },
    ],
    64,
  );
const load: ClusterEffectiveLoad = {
  version: 1,
  artifact: B11307_DEVELOPMENT.artifact,
  modelSha256: '71d6871836886267f39f1ac69b1b1dd8a783970708d7a189960112ed02978901',
  blockCount: 64,
  contextPerSlot: 7680,
  slots: 4,
  threads: null,
  batch: 2048,
  microbatch: 512,
  flashAttention: true,
  cacheK: 'q8_0',
  cacheV: 'q8_0',
  placement: single,
  serverCaches: SERVER_CACHE_POLICY,
  fingerprint: 'f'.repeat(64),
};

describe('b11307 development bootstrap', () => {
  it('requires the exact signed inventory digest', () => {
    const approved = '8ff49bd2e7a09430a1a2b45cb01b429e825710ea34678fbebc24befac61484c8';
    expect(admitsDevelopmentB11307(approved)).toBe(true);
    expect(admitsDevelopmentB11307(approved.slice(0, -1) + '9')).toBe(false);
    expect(admitsDevelopmentB11307(undefined)).toBe(false);
  });

  it('accepts the qualified single-GPU and paired Bonsai placements', () => {
    expect(requireStockClusterProfile(load).cacheLayers).toHaveLength(64);
    expect(requireStockClusterProfile({ ...load, placement: split(31) }).cacheLayers).toHaveLength(
      64,
    );
  });

  it('rejects an unqualified model, load setting or GPU boundary', () => {
    for (const changed of [
      { modelSha256: '0'.repeat(64) },
      { contextPerSlot: 8192 },
      { placement: split(32) },
      { placement: compilePlacement([{ uuid: worker, first: 0, last: 63 }], 64) },
    ]) {
      expect(() => requireStockClusterProfile({ ...load, ...changed })).toThrow(
        'NEEDS_RESOURCE_EVIDENCE',
      );
    }
  });
});
