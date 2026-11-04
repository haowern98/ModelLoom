import os from 'node:os';
import type { RuntimeDevice, DeviceInventory, DeviceGpu } from '../shared/runtime';
import { readWindowsHardware } from './windows-device';
import { readWindowsMetrics } from './windows-metrics';
import { readMacHardware } from './mac-device';
import { readLinuxHardware } from './linux-device';
import { readNvidiaMetrics } from './nvidia-metrics';
import { cpuUsage, diskRates, type DiskSample } from './device-metrics';
import { requireCleanup } from './device-query';

let hardwareCache:
  { at: number; value: Awaited<ReturnType<typeof readWindowsHardware>> } | undefined;
let previousCpus: ReturnType<typeof os.cpus> | undefined;
let previousDisks: DiskSample | undefined;
let inventoryGeneration = 0;

/** Hardware change invalidates both inventory and rate baselines, without granting launch authority. */
export function invalidateDeviceInventory(): void {
  inventoryGeneration++;
  hardwareCache = undefined;
  previousCpus = undefined;
  previousDisks = undefined;
}

/** Local identity is available without an engine, model, GPU or network connection.
 * A trusted role can be supplied independently of hardware discovery. Unknown GPU
 * capacity is omitted, rather than advertised as zero or as validated runtime support.
 */
export async function localDeviceSnapshot(
  role: RuntimeDevice['role'] = 'Coordinator',
): Promise<RuntimeDevice & { inventory: DeviceInventory }> {
  const cpus = os.cpus();
  const generation = inventoryGeneration;
  const platform = os.platform();
  const cpuUsagePercent = cpuUsage(previousCpus, cpus);
  previousCpus = cpus;
  let hardware: Awaited<ReturnType<typeof readWindowsHardware>> = {};
  if (platform === 'win32') {
    const outcomes = await Promise.allSettled([
      hardwareCache && Date.now() - hardwareCache.at < 10000
        ? Promise.resolve(hardwareCache.value)
        : readWindowsHardware().then((value) => {
            if (generation === inventoryGeneration) hardwareCache = { at: Date.now(), value };
            return value;
          }),
      readWindowsMetrics(),
      readNvidiaMetrics(),
    ]);
    requireCleanup(outcomes);
    const [inventory, metrics, nvidia] = outcomes;
    hardware = inventory.status === 'fulfilled' ? inventory.value : {};
    if (metrics.status === 'fulfilled') {
      const fresh = metrics.value;
      hardware = {
        ...hardware,
        ...fresh,
        ...(fresh.gpus !== undefined
          ? {
              gpus: [
                ...(hardware.gpus ?? []).filter((g) => g.pciVendorId !== '1002'),
                ...fresh.gpus,
              ],
            }
          : {}),
      };
    }
    if (nvidia.status === 'fulfilled' && hardware.gpus) {
      hardware = {
        ...hardware,
        gpus: hardware.gpus.map((gpu) => {
          if (gpu.executionIdentity?.vendor !== 'nvidia') return gpu;
          const reading = nvidia.value.find(
            (value) => value.uuid.toLowerCase() === gpu.executionIdentity!.uuid.toLowerCase(),
          );
          if (!reading) return gpu;
          const measurements: Partial<DeviceGpu> = {};
          for (const key of [
            'utilizationPercent',
            'usedMemoryBytes',
            'totalMemoryBytes',
            'availableMemoryBytes',
          ] as const) {
            const value = reading[key];
            if (value !== undefined) measurements[key] = value;
          }
          return { ...gpu, ...measurements };
        }),
      };
    }
  } else if (platform === 'darwin' || platform === 'linux') {
    const outcomes = await Promise.allSettled([
      platform === 'darwin' ? readMacHardware(cpus[0]?.model ?? 'Apple') : readLinuxHardware(),
    ]);
    requireCleanup(outcomes);
    const reading = outcomes[0];
    if (reading.status === 'fulfilled') {
      const { disks, ...facts } = reading.value;
      const sample = disks ? { disks, at: performance.now() } : undefined;
      hardware = { ...facts, ...(sample ? diskRates(previousDisks, sample) : {}) };
      if (generation === inventoryGeneration) previousDisks = sample;
    } else if (generation === inventoryGeneration) previousDisks = undefined;
  }
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
      ...(cpuUsagePercent !== undefined ? { cpuUsagePercent } : {}),
      sampledAt: Date.now(),
    },
    ...(gpu?.totalMemoryBytes !== undefined
      ? { gpuName: gpu.name, gpuMemoryGiB: gpu.totalMemoryBytes / 2 ** 30 }
      : {}),
  };
}
