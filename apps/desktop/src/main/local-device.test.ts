import os from 'node:os';
import { beforeEach, expect, it, vi } from 'vitest';
import { invalidateDeviceInventory, localDeviceSnapshot } from './local-device';
import { readWindowsHardware } from './windows-device';
import { readWindowsMetrics } from './windows-metrics';
import { readMacHardware } from './mac-device';
import { readNvidiaMetrics } from './nvidia-metrics';
vi.mock('./windows-device', () => ({ readWindowsHardware: vi.fn(() => Promise.resolve({})) }));
vi.mock('./windows-metrics', () => ({ readWindowsMetrics: vi.fn(() => Promise.resolve({})) }));
vi.mock('./mac-device', () => ({ readMacHardware: vi.fn(() => Promise.resolve({})) }));
vi.mock('./nvidia-metrics', () => ({ readNvidiaMetrics: vi.fn(() => Promise.resolve([])) }));
beforeEach(() => invalidateDeviceInventory());

it('attaches NVIDIA counters by UUID despite duplicate names and reordered readings', async () => {
  vi.spyOn(os, 'platform').mockReturnValue('win32');
  const a = 'GPU-11111111-1111-1111-1111-111111111111';
  const b = 'GPU-22222222-2222-2222-2222-222222222222';
  vi.mocked(readWindowsHardware).mockResolvedValueOnce({
    gpus: [
      { id: 'virtual', name: 'Virtual display' },
      ...[a, b].map((uuid) => ({
        id: uuid,
        name: 'Same NVIDIA GPU',
        pciVendorId: '10de',
        totalMemoryBytes: 8192,
        executionIdentity: { vendor: 'nvidia' as const, uuid, pciBus: '00000000:01:00.0' },
      })),
    ],
  });
  vi.mocked(readNvidiaMetrics).mockResolvedValueOnce([
    {
      uuid: b,
      utilizationPercent: 0,
      usedMemoryBytes: 2048,
      totalMemoryBytes: 8192,
      availableMemoryBytes: 5000,
    },
    {
      uuid: a,
      utilizationPercent: 60,
      usedMemoryBytes: 4096,
      totalMemoryBytes: 8192,
      availableMemoryBytes: 4000,
    },
  ]);
  const { inventory } = await localDeviceSnapshot();
  expect(inventory.gpus?.map((g) => g.utilizationPercent)).toEqual([undefined, 60, 0]);
  expect(inventory.gpus?.[1]?.usedMemoryBytes).toBe(4096);
  expect(inventory.gpus?.[2]?.usedMemoryBytes).toBe(2048);
  expect(inventory.gpus?.[2]?.availableMemoryBytes).toBe(5000);
  expect(inventory.gpus?.[1]?.executionIdentity?.uuid).toBe(a);
  vi.restoreAllMocks();
});

it('keeps discovered GPUs when NVIDIA telemetry fails and never assigns an unknown UUID by name', async () => {
  vi.spyOn(os, 'platform').mockReturnValue('win32');
  const uuid = 'GPU-11111111-1111-1111-1111-111111111111';
  vi.mocked(readWindowsHardware).mockResolvedValueOnce({
    gpus: [
      {
        id: uuid,
        name: 'NVIDIA',
        pciVendorId: '10de',
        totalMemoryBytes: 8192,
        executionIdentity: { vendor: 'nvidia', uuid, pciBus: '00000000:01:00.0' },
      },
    ],
  });
  vi.mocked(readNvidiaMetrics).mockRejectedValueOnce(Error('QUERY_TIMEOUT'));
  expect((await localDeviceSnapshot()).inventory.gpus?.[0]?.name).toBe('NVIDIA');
  vi.mocked(readNvidiaMetrics).mockResolvedValueOnce([
    { uuid: 'GPU-22222222-2222-2222-2222-222222222222', utilizationPercent: 99 },
  ]);
  expect((await localDeviceSnapshot()).inventory.gpus?.[0]?.utilizationPercent).toBeUndefined();
  vi.mocked(readNvidiaMetrics).mockRejectedValueOnce(Error('QUERY_CLEANUP_FAILED'));
  await expect(localDeviceSnapshot()).rejects.toThrow('QUERY_CLEANUP_FAILED');
  vi.restoreAllMocks();
});

it('does not repopulate the inventory cache from a scan invalidated by hotplug', async () => {
  vi.spyOn(os, 'platform').mockReturnValue('win32');
  let release!: (value: Awaited<ReturnType<typeof readWindowsHardware>>) => void;
  vi.mocked(readWindowsHardware).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const old = localDeviceSnapshot();
  invalidateDeviceInventory();
  release({ gpus: [{ id: 'old', name: 'Removed GPU' }] });
  await old;
  const current = await localDeviceSnapshot();
  expect(readWindowsHardware).toHaveBeenCalledTimes(2);
  expect(current.inventory.gpus?.some((g) => g.id === 'old')).not.toBe(true);
  vi.restoreAllMocks();
});

it('connects AMD telemetry without changing NVIDIA execution identity', async () => {
  vi.spyOn(os, 'platform').mockReturnValue('win32');
  vi.mocked(readWindowsHardware).mockResolvedValueOnce({
    gpus: [
      { id: 'amd-old', name: 'AMD', pciVendorId: '1002' },
      { id: 'nvidia', name: 'NVIDIA', pciVendorId: '10de' },
    ],
  });
  vi.mocked(readWindowsMetrics).mockResolvedValueOnce({
    diskReadBytesPerSecond: 0,
    diskWriteBytesPerSecond: 500,
    gpus: [
      {
        id: 'dxgi-amd',
        name: 'AMD',
        pciVendorId: '1002',
        utilizationPercent: 30,
        usedMemoryBytes: 1000,
      },
    ],
  });
  const snapshot = await localDeviceSnapshot();
  expect(snapshot.inventory.gpus?.map((g) => g.id)).toEqual(['nvidia', 'dxgi-amd']);
  expect(snapshot.inventory.diskReadBytesPerSecond).toBe(0);
  expect(snapshot.inventory.gpus?.[1]?.utilizationPercent).toBe(30);
  vi.restoreAllMocks();
});

it('collects Mac GPU observations without loading the Windows provider', async () => {
  vi.spyOn(os, 'platform').mockReturnValue('darwin');
  vi.mocked(readMacHardware).mockResolvedValueOnce({
    gpus: [
      {
        id: 'ioreg-1',
        name: 'Apple GPU',
        vendor: 'apple',
        memoryKind: 'unified',
        usedMemoryBytes: 4096,
      },
    ],
  });
  const snapshot = await localDeviceSnapshot();
  expect(snapshot.inventory.gpus?.[0]).toMatchObject({ vendor: 'apple', memoryKind: 'unified' });
  expect(readWindowsHardware).not.toHaveBeenCalled();
  expect(readWindowsMetrics).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

it('reports the actual host without model, network or GPU prerequisites', async () => {
  const snapshot = await localDeviceSnapshot();
  expect(snapshot.name).toBe(os.hostname());
  expect(snapshot.cpuName).toBe(os.cpus()[0]?.model ?? 'CPU details unavailable');
  expect(snapshot.threads).toBe(os.cpus().length);
  expect(snapshot.role).toBe('Coordinator');
  expect(snapshot.gpuMemoryGiB).toBeUndefined();
  const worker = await localDeviceSnapshot('Worker');
  expect(worker.role).toBe('Worker');
  expect(worker.inventory?.architecture).toBe(os.machine());
  expect(worker.inventory?.usableRamBytes).toBe(os.totalmem());
  expect(worker.inventory?.availableRamBytes).toBeGreaterThanOrEqual(0);
});

it('preserves the full OS version and each supplied GPU, without GPU prerequisites', async () => {
  vi.spyOn(os, 'platform').mockReturnValueOnce('win32');
  vi.mocked(readWindowsHardware).mockResolvedValueOnce({
    os: 'Windows 11 Home · 24H2 · Build 26100.7623',
    gpus: [{ id: 'gpu-0', name: 'Intel GPU', driverVersion: '31.0' }],
  });
  const snapshot = await localDeviceSnapshot();
  expect(snapshot.os).toBe('Windows 11 Home · 24H2 · Build 26100.7623');
  expect(snapshot.inventory?.gpus).toHaveLength(1);
  expect(snapshot.gpuMemoryGiB).toBeUndefined();
});

it('does not conceal a diagnostic cleanup failure behind CPU-only fallback data', async () => {
  vi.spyOn(os, 'platform').mockReturnValueOnce('win32');
  vi.mocked(readWindowsHardware).mockRejectedValueOnce(new Error('QUERY_CLEANUP_FAILED'));
  await expect(localDeviceSnapshot()).rejects.toThrow('QUERY_CLEANUP_FAILED');
});
