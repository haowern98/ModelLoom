import os from 'node:os';
import type { RuntimeDevice, DeviceInventory } from '../shared/runtime';
import { readWindowsHardware } from './windows-device';

/** Local identity is available without an engine, model, GPU or network connection.
 * A trusted role can be supplied independently of hardware discovery. Unknown GPU
 * capacity is omitted, rather than advertised as zero or as validated runtime support.
 */
export async function localDeviceSnapshot(
  role: RuntimeDevice['role'] = 'Coordinator',
): Promise<RuntimeDevice & { inventory: DeviceInventory }> {
  const cpus = os.cpus();
  const platform = os.platform();
  let hardware: Awaited<ReturnType<typeof readWindowsHardware>> = {};
  if (platform === 'win32')
    hardware = await readWindowsHardware().catch((error: unknown) => {
      if (error instanceof Error && error.message === 'QUERY_CLEANUP_FAILED') throw error;
      return {};
    });
  const { os: observedOs, ...inventory } = hardware;
  const gpu = inventory.gpus?.find((g) => g.totalMemoryBytes !== undefined);
  return {
    name: os.hostname(),
    os: observedOs ?? `${os.version()} · ${os.release()}`,
    cpuName: cpus[0]?.model ?? 'CPU details unavailable',
    threads: cpus.length,
    role,
    inventory: {
      ...inventory,
      architecture: os.machine(),
      usableRamBytes: os.totalmem(),
      availableRamBytes: os.freemem(),
      sampledAt: Date.now(),
    },
    ...(gpu?.totalMemoryBytes !== undefined
      ? { gpuName: gpu.name, gpuMemoryGiB: gpu.totalMemoryBytes / 2 ** 30 }
      : {}),
  };
}
