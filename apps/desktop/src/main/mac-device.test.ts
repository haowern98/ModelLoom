import { expect, it } from 'vitest';
import { parseMacHardware, parseMacDisks, readMacHardware } from './mac-device';

it('reads Apple GPU activity and unified allocation without inventing dedicated VRAM', () => {
  const result = parseMacHardware(
    [
      {
        IORegistryEntryID: 42,
        IOClass: 'AGXAccelerator',
        PerformanceStatistics: { 'Device Utilization %': 32, 'In use system memory': 4096 },
      },
    ],
    'Apple M4',
  );
  expect(result.gpus).toEqual([
    {
      id: 'ioreg-42',
      name: 'Apple M4 GPU',
      vendor: 'apple',
      memoryKind: 'unified',
      utilizationPercent: 32,
      usedMemoryBytes: 4096,
    },
  ]);
  expect(result.gpus?.[0]?.totalMemoryBytes).toBeUndefined();
});

it('keeps identical AMD Macs separate and reports missing/invalid readings as unknown', () => {
  const result = parseMacHardware(
    [1, 2].map((id) => ({
      IORegistryEntryID: id,
      IOClass: 'AMDRadeonX6000_AMDAccel',
      model: 'AMD Radeon',
      PerformanceStatistics: {
        'GPU Activity(%)': id === 1 ? 0 : 101,
        vramUsedBytes: id === 1 ? 1024 : -1,
        vramTotalBytes: 8192,
      },
    })),
    'Intel',
  );
  expect(result.gpus?.map((g) => g.id)).toEqual(['ioreg-1', 'ioreg-2']);
  expect(result.gpus?.[0]).toMatchObject({
    pciVendorId: '1002',
    utilizationPercent: 0,
    usedMemoryBytes: 1024,
    totalMemoryBytes: 8192,
    memoryKind: 'dedicated',
  });
  expect(result.gpus?.[1]?.utilizationPercent).toBeUndefined();
  expect(result.gpus?.[1]?.usedMemoryBytes).toBeUndefined();
  expect(parseMacHardware([], 'Apple M4').gpus).toEqual([]);
});

it('reads physical disk totals once per registry identity and rejects malformed counts', () => {
  expect(
    parseMacDisks([
      { IORegistryEntryID: 7, Statistics: { 'Bytes (Read)': 123, 'Bytes (Write)': 0 } },
    ]),
  ).toEqual([{ id: '7', read: 123, write: 0 }]);
  expect(parseMacDisks([{ IORegistryEntryID: 7, Statistics: { 'Bytes (Read)': -1 } }])).toEqual([]);
});

it('also reports Intel Mac GPU activity without labelling shared memory as VRAM', () => {
  expect(
    parseMacHardware(
      [
        {
          IORegistryEntryID: 3,
          IOClass: 'IntelAccelerator',
          PerformanceStatistics: { 'Device Utilization %': 5, 'In use system memory': 1024 },
        },
      ],
      'Intel CPU',
    ).gpus?.[0],
  ).toMatchObject({
    vendor: 'intel',
    memoryKind: 'unified',
    utilizationPercent: 5,
    usedMemoryBytes: 1024,
  });
});

it('isolates a failed disk provider from GPU facts and propagates failed cleanup', async () => {
  const run = (_exe: string, args: string[]) => {
    if (args.includes('IOBlockStorageDriver')) return Promise.reject(Error('DENIED'));
    if (args.includes('IOAccelerator')) return Promise.resolve(Buffer.from('plist'));
    return Promise.resolve(
      Buffer.from(JSON.stringify([{ IORegistryEntryID: 42, IOClass: 'AGXAccelerator' }])),
    );
  };
  expect((await readMacHardware('Apple M4', run)).gpus).toHaveLength(1);
  await expect(
    readMacHardware('Apple M4', () => Promise.reject(Error('QUERY_CLEANUP_FAILED'))),
  ).rejects.toThrow('QUERY_CLEANUP_FAILED');
});
