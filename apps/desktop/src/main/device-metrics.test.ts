import { expect, it } from 'vitest';
import { cpuUsage, diskRates } from './device-metrics';

it('measures CPU deltas and rejects first samples, resets and topology changes', () => {
  const a = [{ times: { user: 10, nice: 0, sys: 10, idle: 80, irq: 0 } }];
  const b = [{ times: { user: 20, nice: 0, sys: 20, idle: 160, irq: 0 } }];
  expect(cpuUsage(undefined, b)).toBeUndefined();
  expect(cpuUsage(a, b)).toBe(20);
  expect(cpuUsage(b, a)).toBeUndefined();
  expect(cpuUsage(a, [...b, ...b])).toBeUndefined();
  expect(cpuUsage(b, b)).toBeUndefined();
});

it('measures disk activity with elapsed time, preserving idle zero and resetting on hotplug', () => {
  const a = { at: 100, disks: [{ id: 'a', read: 1000, write: 2000 }] };
  const b = { at: 2100, disks: [{ id: 'a', read: 3000, write: 2000 }] };
  expect(diskRates(undefined, b)).toEqual({});
  expect(diskRates(a, b)).toEqual({ diskReadBytesPerSecond: 1000, diskWriteBytesPerSecond: 0 });
  expect(diskRates(b, a)).toEqual({});
  expect(diskRates(a, { ...b, disks: [{ id: 'new', read: 3000, write: 2000 }] })).toEqual({});
});
