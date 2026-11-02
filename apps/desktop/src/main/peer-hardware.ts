import { decodePeerHardware } from '../../../../packages/core/src/peers/hardware';
import type { PeerHardware } from '../../../../packages/core/src/peers/hardware';
import type { RuntimeDevice } from '../shared/runtime';

/** Convert this PC's accepted scan to display facts, never inferred launch authority. */
export function toPeerHardware(device: RuntimeDevice): PeerHardware {
  const inventory = device.inventory;
  return decodePeerHardware({
    os: device.os,
    ...(device.cpuName ? { cpuName: device.cpuName } : {}),
    threads: device.threads,
    sampledAt: inventory?.sampledAt ?? Date.now(),
    ...Object.fromEntries(
      (
        [
          'architecture',
          'cpuCores',
          'installedRamBytes',
          'usableRamBytes',
          'availableRamBytes',
          'runtimeBackends',
          'cpuUsagePercent',
          'diskReadBytesPerSecond',
          'diskWriteBytesPerSecond',
        ] as const
      )
        .filter((key) => inventory?.[key] !== undefined)
        .map((key) => [key, inventory![key]]),
    ),
    gpus: (inventory?.gpus ?? [])
      .filter(
        (gpu) =>
          gpu.pciVendorId === '10de' &&
          gpu.enabled !== false &&
          gpu.executionIdentity?.vendor === 'nvidia' &&
          gpu.totalMemoryBytes !== undefined,
      )
      .map((gpu) => ({
        id: gpu.executionIdentity!.uuid,
        name: gpu.name,
        memoryBytes: gpu.totalMemoryBytes!,
        ...(gpu.availableMemoryBytes !== undefined
          ? { availableMemoryBytes: gpu.availableMemoryBytes }
          : {}),
        ...(gpu.driverVersion ? { driverVersion: gpu.driverVersion } : {}),
        ...(gpu.utilizationPercent !== undefined
          ? { utilizationPercent: gpu.utilizationPercent }
          : {}),
        ...(gpu.usedMemoryBytes !== undefined ? { usedMemoryBytes: gpu.usedMemoryBytes } : {}),
        ...(gpu.memoryKind !== undefined ? { memoryKind: gpu.memoryKind } : {}),
      })),
  });
}
