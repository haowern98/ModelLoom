import { expect, it } from 'vitest';
import { peerDevices } from './peer-devices';
import type { PeerView } from '../../../shared/peers';

it('shows only mutually approved GPU inventory, qualified by its installation', () => {
  const gpu = {
    id: 'GPU-11111111-1111-1111-1111-111111111111',
    name: 'Remote GPU',
    memoryBytes: 8 * 2 ** 30,
  };
  const request = {
    id: 'request',
    name: 'Malaysia',
    peerFingerprint: 'b'.repeat(64),
    phase: 'approved' as const,
    localVerified: true,
    remoteVerified: true,
    gpus: [gpu],
  };
  const view: PeerView = {
    fingerprint: 'a'.repeat(64),
    name: 'SG',
    sharing: false,
    addresses: [],
    gpus: [],
    sharedGpuIds: [],
    incoming: [],
    outgoing: [request],
  };
  expect(peerDevices(view)[0]?.hardware[0]?.assignmentId).toBe(`peer:${'b'.repeat(64)}:${gpu.id}`);
  expect(peerDevices({ ...view, outgoing: [{ ...request, remoteVerified: false }] })).toEqual([]);
  expect(peerDevices({ ...view, outgoing: [{ ...request, phase: 'disconnected' }] })).toEqual([]);
  const detailed = {
    ...request,
    address: '100.64.0.2',
    hardware: {
      os: 'Windows 11',
      architecture: 'x86_64',
      cpuName: 'PTSS CPU',
      cpuCores: 8,
      threads: 16,
      installedRamBytes: 32 * 2 ** 30,
      usableRamBytes: 31 * 2 ** 30,
      availableRamBytes: 10 * 2 ** 30,
      runtimeBackends: ['CUDA'],
      sampledAt: 123,
      gpus: [
        { ...gpu, availableMemoryBytes: 4 * 2 ** 30, driverVersion: '617.14' },
        { ...gpu, id: 'unshared' },
      ],
    },
  };
  const device = peerDevices({ ...view, outgoing: [detailed] })[0]!;
  expect(device.os).toBe('Windows 11');
  expect(device.address).toBe('100.64.0.2');
  expect(device.hardware[0]).toMatchObject({
    kind: 'cpu',
    name: 'PTSS CPU',
    detail: '8 cores · 16 threads',
  });
  expect(device.hardware[0]).not.toHaveProperty('assignmentId');
  expect(device.inventory).toMatchObject({
    architecture: 'x86_64',
    cpuCores: 8,
    availableRamBytes: 10 * 2 ** 30,
    sampledAt: 123,
  });
  expect(device.inventory?.gpus).toHaveLength(1);
  expect(device.inventory?.gpus?.[0]).toMatchObject({
    availableMemoryBytes: 4 * 2 ** 30,
    driverVersion: '617.14',
  });
  expect(device.inventory?.gpus?.[0]?.id).toBe(device.hardware[1]?.id);
  expect(peerDevices({ ...view, outgoing: [{ ...detailed, gpus: [] }] })[0]?.hardware).toHaveLength(
    1,
  );
});
