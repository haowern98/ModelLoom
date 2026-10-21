import { expect, it } from 'vitest';
import { decodePeerResources, peerRuntimeId, RPC_RUNTIME_FILES } from './resources.js';
import { inventory } from '../../tests/inventory-fixture.js';
import type { Inventory } from '../runtime-package/inventory.js';

it('binds runtime compatibility to the full required stock payload', () => {
  const signed: Inventory = {
    ...inventory,
    schemaVersion: 1,
    platform: 'win32',
    arch: 'x64',
    protocol: 1,
    stop: 'private-console-ctrl-c',
    backend: 'cuda' as const,
    upstreamCommit: '4f31296a907d73f3409f720429bcf31111615d77',
    files: RPC_RUNTIME_FILES.map((path) => ({ path, length: 1, sha256: 'a'.repeat(64) })),
  };
  expect(peerRuntimeId(signed)).not.toBe(
    peerRuntimeId({
      ...signed,
      files: signed.files.map((file, i) => (i ? file : { ...file, sha256: 'b'.repeat(64) })),
    }),
  );
  expect(() => peerRuntimeId({ ...signed, files: signed.files.slice(1) })).toThrow(
    'RPC_PACKAGE_REQUIRED',
  );
});
it('rejects incomplete, oversized and inconsistent selected hardware observations', () => {
  const gpu = {
    uuid: 'GPU-11111111-1111-1111-1111-111111111111',
    bus: '00000000:01:00.0',
    driver: '617.14',
    total: 4096,
    free: 1024,
    mig: '[N/A]',
    driverModel: 'WDDM',
  };
  const report = { runtimeId: 'a'.repeat(64), ram: 8192, gpus: [gpu] };
  expect(decodePeerResources(report).gpus).toHaveLength(1);
  expect(() => decodePeerResources({ ...report, gpus: [{ ...gpu, free: 8192 }] })).toThrow(
    'NEEDS_RESOURCE_EVIDENCE',
  );
  expect(() => decodePeerResources({ ...report, gpus: [gpu, gpu] })).toThrow(
    'NEEDS_RESOURCE_EVIDENCE',
  );
  expect(() => decodePeerResources({ ...report, ram: null })).toThrow('NEEDS_RESOURCE_EVIDENCE');
});
