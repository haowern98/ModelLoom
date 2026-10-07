import os from 'node:os';
import { expect, it } from 'vitest';
import { localDeviceSnapshot } from './local-device';

it('reports the actual host without model, network or GPU prerequisites', () => {
  const snapshot = localDeviceSnapshot();
  expect(snapshot.name).toBe(os.hostname());
  expect(snapshot.cpuName).toBe(os.cpus()[0]?.model ?? 'CPU details unavailable');
  expect(snapshot.threads).toBe(os.cpus().length);
  expect(snapshot.role).toBe('Coordinator');
  expect(snapshot.gpuMemoryGiB).toBeUndefined();
  expect(localDeviceSnapshot('Worker')).toEqual({ ...snapshot, role: 'Worker' });
});
