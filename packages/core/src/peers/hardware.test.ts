import { expect, it } from 'vitest';
import { decodePeerHardware } from './hardware.js';

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
