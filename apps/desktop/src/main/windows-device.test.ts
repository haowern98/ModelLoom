import { expect, it, vi } from 'vitest';
import { parseWindowsHardware, mergeGpuReadings, readWindowsHardware } from './windows-device';

it('reads the Windows edition, release, full build, physical RAM and CPU cores', () => {
  const result = parseWindowsHardware({
    os: { Caption: 'Microsoft Windows 11 Home', Version: '10.0.26100', BuildNumber: '26100' },
    release: { DisplayVersion: '24H2', UBR: 7623 },
    processors: [{ NumberOfCores: 14, NumberOfLogicalProcessors: 20 }],
    memory: [{ Capacity: '17179869184' }, { Capacity: '17179869184' }],
    gpus: [],
  });
  expect(result.os).toBe('Microsoft Windows 11 Home · 24H2 · Build 26100.7623');
  expect(result.installedRamBytes).toBe(32 * 2 ** 30);
  expect(result.cpuCores).toBe(14);
  expect(result.gpus).toEqual([]);
});

it.each(['Intel Iris Xe Graphics', 'AMD Radeon 780M', 'NVIDIA GeForce RTX 4060'])(
  'enumerates %s and its driver without needing NVIDIA tooling',
  (name) => {
    const result = parseWindowsHardware({
      gpus: [{ Name: name, DriverVersion: '32.0.101.6651', dedicatedBytes: '8589934592' }],
    });
    expect(result.gpus).toEqual([
      { id: 'gpu-0', name, driverVersion: '32.0.101.6651', totalMemoryBytes: 8 * 2 ** 30 },
    ]);
  },
);

it('never substitutes truncated AdapterRAM, shared RAM or invalid numbers for VRAM', () => {
  const result = parseWindowsHardware({
    memory: [{ Capacity: 'bad' }],
    gpus: [{ Name: 'Integrated GPU', AdapterRAM: 4293918720, dedicatedBytes: -1 }],
  });
  expect(result.installedRamBytes).toBeUndefined();
  expect(result.gpus?.[0]?.totalMemoryBytes).toBeUndefined();
  expect(result.gpus?.[0]?.availableMemoryBytes).toBeUndefined();
  expect(result.os).toBeUndefined();
});

it('derives PCI vendor identity without trusting display names or virtual adapter IDs', () => {
  const result = parseWindowsHardware({
    gpus: [
      { Name: 'Discrete A', PNPDeviceID: 'PCI\\VEN_10DE&DEV_2803&SUBSYS_00000000\\instance' },
      { Name: 'Integrated A', PNPDeviceID: 'pci\\ven_1002&dev_15bf\\instance' },
      { Name: 'Integrated B', PNPDeviceID: 'PCI\\VEN_8086&DEV_46A6\\instance' },
      { Name: 'NVIDIA virtual display', PNPDeviceID: 'ROOT\\VEN_10DE&DEV_0000\\0000' },
      { Name: 'AMD named adapter without identity' },
      { Name: 'Malformed identity', PNPDeviceID: 'PCI\\VEN_10DEFAKE&DEV_0000' },
    ],
  });
  expect(result.gpus?.map((gpu) => gpu.pciVendorId)).toEqual([
    '10de',
    '1002',
    '8086',
    undefined,
    undefined,
    undefined,
  ]);
});

it('observes disabled and failed devices separately from unknown or working status', () => {
  const result = parseWindowsHardware({
    gpus: [0, 22, 43, undefined].map((code) => ({ Name: 'GPU', ConfigManagerErrorCode: code })),
  });
  expect(result.gpus?.map((gpu) => gpu.enabled)).toEqual([true, false, false, undefined]);
});

it('isolates absent providers and rejects oversized or malformed reports', () => {
  expect(parseWindowsHardware({ os: null, memory: null, gpus: null }).gpus).toBeUndefined();
  expect(() => parseWindowsHardware([])).toThrow('INVALID_HARDWARE');
  expect(() => parseWindowsHardware({ gpus: Array.from({ length: 65 }, () => ({})) })).toThrow(
    'INVALID_HARDWARE',
  );
});

it('merges fresh GPU memory only for an unambiguous matching adapter', () => {
  const gpu = { id: 'gpu-0', name: 'NVIDIA GPU', driverVersion: '32.0.15.7000' };
  const reading = {
    uuid: 'uuid',
    name: 'NVIDIA GPU',
    total: 16 * 2 ** 30,
    free: 12 * 2 ** 30,
    driver: '570.00',
  };
  expect(mergeGpuReadings([gpu], [reading])).toEqual([
    { ...gpu, totalMemoryBytes: reading.total, availableMemoryBytes: reading.free },
  ]);
  expect(
    mergeGpuReadings([gpu, { ...gpu, id: 'gpu-1' }], [reading])?.[0]?.availableMemoryBytes,
  ).toBeUndefined();
  expect(mergeGpuReadings([gpu], undefined)).toEqual([gpu]);
});

it('still reads an AMD laptop when NVIDIA tooling is absent', async () => {
  vi.stubEnv('SystemRoot', 'C:\\Windows');
  try {
    const runner = vi.fn((file: string) => {
      if (file.endsWith('nvidia-smi.exe')) return Promise.reject(new Error('ENOENT'));
      return Promise.resolve(
        Buffer.from(
          JSON.stringify({
            os: { Caption: 'Microsoft Windows 11 Pro', BuildNumber: '26100' },
            gpus: [{ Name: 'AMD Radeon 780M', DriverVersion: '32.0.12000' }],
            memory: [{ Capacity: '17179869184' }],
          }),
        ),
      );
    });
    const result = await readWindowsHardware(runner);
    expect(result.os).toBe('Microsoft Windows 11 Pro · Build 26100');
    expect(result.installedRamBytes).toBe(16 * 2 ** 30);
    expect(result.gpus?.[0]?.name).toBe('AMD Radeon 780M');
    expect(result.gpus?.[0]?.availableMemoryBytes).toBeUndefined();
    expect(runner).toHaveBeenCalledTimes(2);
  } finally {
    vi.unstubAllEnvs();
  }
});

it('preserves NVIDIA readings when WMI is denied and keeps all-provider failures unknown', async () => {
  vi.stubEnv('SystemRoot', 'C:\\Windows');
  try {
    const runner = (file: string) => {
      if (!file.endsWith('nvidia-smi.exe')) return Promise.reject(new Error('ACCESS_DENIED'));
      return Promise.resolve(
        Buffer.from(
          'GPU-12345678-1234-1234-1234-123456789abc, 00000000:01:00.0, 570.00, 8192, 6144, [N/A], WDDM, Test GPU',
        ),
      );
    };
    expect((await readWindowsHardware(runner)).gpus?.[0]?.availableMemoryBytes).toBe(6 * 2 ** 30);
    expect((await readWindowsHardware(runner)).gpus?.[0]?.pciVendorId).toBe('10de');
    expect(await readWindowsHardware(() => Promise.reject(new Error('DENIED')))).toEqual({});
  } finally {
    vi.unstubAllEnvs();
  }
});

it('propagates failed child cleanup instead of disguising it as missing hardware', async () => {
  vi.stubEnv('SystemRoot', 'C:\\Windows');
  try {
    await expect(
      readWindowsHardware(() => Promise.reject(new Error('QUERY_CLEANUP_FAILED'))),
    ).rejects.toThrow('QUERY_CLEANUP_FAILED');
  } finally {
    vi.unstubAllEnvs();
  }
});
