import { expect, it } from 'vitest';
import { parseWindowsMetrics } from './windows-metrics';

it('matches AMD memory/activity by LUID, including identical names in reverse order', () => {
  const data = {
    adapters: [2, 1].map((n) => ({
      name: 'Same AMD',
      vendor: 4098,
      luid: `0x00000000_0x0000000${n}`,
      memory: 8192,
    })),
    memory: [
      { Name: 'luid_0x00000000_0x00000001_phys_0', DedicatedUsage: 1024 },
      { Name: 'luid_0x00000000_0x00000002_phys_0', DedicatedUsage: 2048 },
    ],
    engines: [
      {
        Name: 'pid_1_luid_0x00000000_0x00000001_phys_0_eng_0_engtype_3D',
        UtilizationPercentage: 20,
      },
      {
        Name: 'pid_2_luid_0x00000000_0x00000001_phys_0_eng_0_engtype_3D',
        UtilizationPercentage: 30,
      },
      {
        Name: 'pid_1_luid_0x00000000_0x00000001_phys_0_eng_1_engtype_Compute',
        UtilizationPercentage: 40,
      },
    ],
    disk: { DiskReadBytesPersec: 0, DiskWriteBytesPersec: 200 },
  };
  const result = parseWindowsMetrics(data);
  expect(result.gpus?.map((g) => g.usedMemoryBytes)).toEqual([2048, 1024]);
  expect(result.gpus?.[1]?.utilizationPercent).toBe(50);
  expect(result.gpus?.[0]?.utilizationPercent).toBeUndefined();
  expect(result.diskReadBytesPerSecond).toBe(0);
  expect(result.diskWriteBytesPerSecond).toBe(200);
});

it('does not invent utilization or free memory when counters are absent or invalid', () => {
  const result = parseWindowsMetrics({
    adapters: [{ name: 'AMD', vendor: 4098, luid: '0x00000000_0x00000001', memory: 8192 }],
    memory: [{ Name: 'luid_0x00000000_0x00000001_phys_0', DedicatedUsage: 99999 }],
  });
  expect(result.gpus?.[0]?.usedMemoryBytes).toBeUndefined();
  expect(result.gpus?.[0]?.utilizationPercent).toBeUndefined();
});
