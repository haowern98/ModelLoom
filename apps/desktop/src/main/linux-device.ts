import { readdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { DeviceGpu, DeviceInventory } from '../shared/runtime';
import type { DiskCounter } from './device-metrics';
import { observationNumber as number, observationText as text } from './device-query';

const native = { list: readdir, read: (file: string) => readFile(file, 'utf8'), path: realpath };

/** amdgpu's read-only sysfs interface needs no vendor CLI, elevation or inference context. */
export async function readLinuxHardware(
  io: {
    list(directory: string): Promise<string[]>;
    read(file: string): Promise<string>;
    path(file: string): Promise<string>;
  } = native,
): Promise<Partial<DeviceInventory> & { disks?: DiskCounter[] }> {
  const read = async (file: string) => {
    try {
      const value = await io.read(file);
      return value.length <= 65536 ? value.trim() : undefined;
    } catch {
      return undefined;
    }
  };
  let gpus: DeviceGpu[] | undefined;
  try {
    const cards = (await io.list('/sys/class/drm')).filter((name) => /^card\d+$/u.test(name));
    if (cards.length > 64) throw Error('INVALID_TELEMETRY');
    const readings = await Promise.allSettled(
      cards.map(async (card) => {
        const base = `/sys/class/drm/${card}/device`;
        if ((await read(`${base}/vendor`)) !== '0x1002') return [];
        const physical = path.posix.basename(await io.path(base));
        if (!/^[0-9a-f]{4}:[0-9a-f]{2}:[0-9a-f]{2}\.[0-7]$/iu.test(physical)) return [];
        const [name, device, total, used, busy] = await Promise.all(
          [
            'product_name',
            'device',
            'mem_info_vram_total',
            'mem_info_vram_used',
            'gpu_busy_percent',
          ].map((key) => read(`${base}/${key}`)),
        );
        const totalMemoryBytes = number(total),
          allocation = number(used),
          utilizationPercent = number(busy, 100);
        const usedMemoryBytes =
          allocation !== undefined &&
          (totalMemoryBytes === undefined || allocation <= totalMemoryBytes)
            ? allocation
            : undefined;
        return [
          {
            id: `pci-${physical.toLowerCase()}`,
            name:
              text(name) ??
              `AMD GPU${/^0x[0-9a-f]{4}$/iu.test(device ?? '') ? ` (${device})` : ''}`,
            pciVendorId: '1002',
            memoryKind: 'dedicated' as const,
            ...(totalMemoryBytes !== undefined && totalMemoryBytes > 0 ? { totalMemoryBytes } : {}),
            ...(usedMemoryBytes !== undefined
              ? {
                  usedMemoryBytes,
                  ...(totalMemoryBytes !== undefined
                    ? { availableMemoryBytes: totalMemoryBytes - usedMemoryBytes }
                    : {}),
                }
              : {}),
            ...(utilizationPercent !== undefined ? { utilizationPercent } : {}),
          },
        ];
      }),
    );
    gpus = readings.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
    if (gpus.length > 16 || new Set(gpus.map((g) => g.id)).size !== gpus.length) gpus = undefined;
  } catch {
    /* An unavailable GPU provider does not hide independent disk readings. */
  }
  let disks: DiskCounter[] | undefined;
  const diskStats = await read('/proc/diskstats');
  if (diskStats !== undefined) {
    const rows = await Promise.all(
      diskStats.split('\n').map(async (line) => {
        const fields = line.trim().split(/\s+/u),
          name = fields[2];
        if (!name || !/^[a-zA-Z0-9_-]+$/u.test(name)) return [];
        // Only physical block devices, excluding partitions and virtual stacked devices.
        try {
          await io.path(`/sys/block/${name}/device`);
        } catch {
          return [];
        }
        const read = number(fields[5]),
          write = number(fields[9]);
        return read !== undefined &&
          write !== undefined &&
          Number.isSafeInteger(read * 512) &&
          Number.isSafeInteger(write * 512)
          ? [{ id: `${fields[0]}:${fields[1]}:${name}`, read: read * 512, write: write * 512 }]
          : [];
      }),
    );
    disks = rows.flat();
  }
  return { ...(gpus !== undefined ? { gpus } : {}), ...(disks !== undefined ? { disks } : {}) };
}
