import { expect, it } from 'vitest';
import { toPeerHardware } from './peer-hardware';
import type { RuntimeDevice } from '../shared/runtime';

it('publishes physical enabled NVIDIA readings and preserves measured zero', () => {
  const gpu = {
    id: 'display',
    name: 'NVIDIA GPU',
    pciVendorId: '10de',
    enabled: true,
    totalMemoryBytes: 12000,
    availableMemoryBytes: 0,
    driverVersion: '617.14',
    executionIdentity: {
      vendor: 'nvidia' as const,
      uuid: 'GPU-11111111-1111-1111-1111-111111111111',
      pciBus: '0000:01:00.0',
    },
  };
  const device: RuntimeDevice = {
    name: 'ptss',
    os: 'Windows',
    cpuName: 'PTSS CPU',
    threads: 8,
    role: 'Worker',
    inventory: {
      sampledAt: 123,
      availableRamBytes: 0,
      cpuCores: 4,
      gpus: [
        gpu,
        { ...gpu, enabled: false },
        { ...gpu, executionIdentity: null },
        { ...gpu, pciVendorId: '1002' },
      ],
    },
  };
  expect(toPeerHardware(device)).toEqual({
    os: 'Windows',
    cpuName: 'PTSS CPU',
    threads: 8,
    sampledAt: 123,
    availableRamBytes: 0,
    cpuCores: 4,
    gpus: [
      {
        id: gpu.executionIdentity.uuid,
        name: gpu.name,
        memoryBytes: 12000,
        availableMemoryBytes: 0,
        driverVersion: '617.14',
      },
    ],
  });
});

it('does not invent missing memory or runtime verification', () => {
  expect(
    toPeerHardware({ name: 'ptss', os: 'Windows', cpuName: '', threads: 8, role: 'Worker' }),
  ).toMatchObject({ os: 'Windows', threads: 8, gpus: [] });
  expect(
    toPeerHardware({ name: 'ptss', os: 'Windows', cpuName: '', threads: 8, role: 'Worker' }),
  ).not.toHaveProperty('runtimeBackends');
});
