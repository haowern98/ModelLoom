import os from 'node:os';
import { expect, it, vi } from 'vitest';
import { localDeviceSnapshot } from './local-device';
import { readWindowsHardware } from './windows-device';
vi.mock('./windows-device', () => ({ readWindowsHardware: vi.fn(() => Promise.resolve({})) }));

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
