import { expect, it } from 'vitest';
import { readLinuxHardware } from './linux-device';

it('reads AMD sysfs counters with physical PCI identities, preserving idle zero', async () => {
  const values: Record<string, string> = {
    vendor: '0x1002',
    device: '0x744c',
    product_name: 'AMD Radeon',
    gpu_busy_percent: '0',
    mem_info_vram_total: '8192',
    mem_info_vram_used: '1024',
  };
  const result = await readLinuxHardware({
    list: () => Promise.resolve(['card2', 'card2-DP-1', 'renderD128']),
    path: () => Promise.resolve('/sys/devices/pci0000:00/0000:03:00.0'),
    read: (file) => Promise.resolve(values[file.split('/').at(-1)!] ?? ''),
  });
  expect(result.gpus).toEqual([
    {
      id: 'pci-0000:03:00.0',
      name: 'AMD Radeon',
      pciVendorId: '1002',
      memoryKind: 'dedicated',
      totalMemoryBytes: 8192,
      usedMemoryBytes: 1024,
      availableMemoryBytes: 7168,
      utilizationPercent: 0,
    },
  ]);
});

it('keeps an AMD adapter visible if optional driver counters fail', async () => {
  const result = await readLinuxHardware({
    list: () => Promise.resolve(['card0']),
    path: () => Promise.resolve('/sys/devices/0000:01:00.0'),
    read: (file) =>
      file.endsWith('/vendor') ? Promise.resolve('0x1002') : Promise.reject(Error('ENOENT')),
  });
  expect(result.gpus?.[0]).toMatchObject({ id: 'pci-0000:01:00.0', pciVendorId: '1002' });
  expect(result.gpus?.[0]?.utilizationPercent).toBeUndefined();
  expect(result.gpus?.[0]?.usedMemoryBytes).toBeUndefined();
});

it('keeps the remaining GPU when one adapter disappears during enumeration', async () => {
  const result = await readLinuxHardware({
    list: () => Promise.resolve(['card0', 'card1']),
    path: (file) =>
      file.includes('card0')
        ? Promise.reject(Error('ENOENT'))
        : Promise.resolve('/sys/devices/0000:02:00.0'),
    read: (file) => Promise.resolve(file.endsWith('/vendor') ? '0x1002' : ''),
  });
  expect(result.gpus?.map((g) => g.id)).toEqual(['pci-0000:02:00.0']);
});
