import { expect, it } from 'vitest';
import { decodePeerHardware, peerHardwareView } from './hardware.js';

it('omits new metrics for older inventory readers without mutating the current snapshot', () => {
  const input = {
    os: 'Windows',
    sampledAt: 1,
    cpuUsagePercent: 50,
    diskReadBytesPerSecond: 10,
    gpus: [
      {
        id: 'gpu',
        name: 'GPU',
        memoryBytes: 8192,
        utilizationPercent: 20,
        usedMemoryBytes: 1000,
        memoryKind: 'dedicated' as const,
        pciVendorId: '1002',
      },
    ],
  };
  expect(peerHardwareView(input, false)).toEqual({
    os: 'Windows',
    sampledAt: 1,
    gpus: [{ id: 'gpu', name: 'GPU', memoryBytes: 8192 }],
  });
  expect(peerHardwareView(input, true)).toEqual(input);
  expect(input.cpuUsagePercent).toBe(50);
});

it('carries bounded optional display telemetry without treating unified memory as dedicated capacity', () => {
  const input = {
    os: 'macOS',
    sampledAt: 1,
    cpuUsagePercent: 12.5,
    diskReadBytesPerSecond: 0,
    diskWriteBytesPerSecond: 2048,
    gpus: [
      {
        id: 'apple',
        name: 'Apple GPU',
        memoryBytes: 0,
        vendor: 'apple',
        memoryKind: 'unified',
        usedMemoryBytes: 4096,
        utilizationPercent: 20,
      },
    ],
  };
  expect(decodePeerHardware(input)).toEqual(input);
  for (const patch of [
    { cpuUsagePercent: 101 },
    { diskReadBytesPerSecond: -1 },
    { cpuUsagePercent: NaN },
  ])
    expect(() => decodePeerHardware({ ...input, ...patch })).toThrow('INVALID_HARDWARE');
  for (const patch of [
    { utilizationPercent: Infinity },
    { usedMemoryBytes: -1 },
    { memoryKind: 'fake' },
  ])
    expect(() => decodePeerHardware({ ...input, gpus: [{ ...input.gpus[0], ...patch }] })).toThrow(
      'INVALID_HARDWARE',
    );
});

it('keeps bounded reported facts and rejects unknown fields and invalid readings', () => {
  const data = {
    os: 'Windows',
    architecture: 'x86_64',
    cpuName: 'Remote CPU',
    threads: 20,
    cpuCores: 14,
    installedRamBytes: 24000,
    usableRamBytes: 23000,
    availableRamBytes: 8000,
    sampledAt: 123,
    runtimeBackends: ['cuda'],
    gpus: [
      {
        id: 'gpu',
        name: 'Remote GPU',
        memoryBytes: 12000,
        availableMemoryBytes: 9000,
        driverVersion: '617.14',
      },
    ],
  };
  expect(decodePeerHardware(data)).toEqual(data);
  for (const value of [
    { ...data, secret: 'no' },
    { ...data, threads: -1 },
    { ...data, availableRamBytes: Number.NaN },
    { ...data, gpus: [{ ...data.gpus[0], availableMemoryBytes: 13000 }] },
    { ...data, gpus: [{ ...data.gpus[0], executable: 'worker' }] },
    { ...data, runtimeBackends: Array.from({ length: 16 }, () => '字'.repeat(256)) },
  ]) {
    expect(() => decodePeerHardware(value)).toThrow('INVALID_HARDWARE');
  }
});
