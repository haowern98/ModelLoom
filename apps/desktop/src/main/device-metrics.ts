import type { CpuInfo } from 'node:os';

type CpuSample = readonly { times: CpuInfo['times'] }[];
export interface DiskCounter {
  id: string;
  read: number;
  write: number;
}
export interface DiskSample {
  at: number;
  disks: readonly DiskCounter[];
}

/** Host-wide utilization between consecutive observations, not process CPU or load average. */
export function cpuUsage(previous: CpuSample | undefined, current: CpuSample): number | undefined {
  if (!previous?.length || previous.length !== current.length) return;
  let elapsed = 0,
    idle = 0;
  for (let i = 0; i < current.length; i++) {
    const before = previous[i]!.times,
      after = current[i]!.times;
    for (const key of ['user', 'nice', 'sys', 'idle', 'irq'] as const) {
      const delta = after[key] - before[key];
      if (!Number.isFinite(delta) || delta < 0) return;
      elapsed += delta;
      if (key === 'idle') idle += delta;
    }
  }
  return elapsed > 0 ? (100 * (elapsed - idle)) / elapsed : undefined;
}

/** Reset all rate baselines on topology changes or counter regression. */
export function diskRates(
  previous: DiskSample | undefined,
  current: DiskSample,
): {
  diskReadBytesPerSecond?: number;
  diskWriteBytesPerSecond?: number;
} {
  if (
    !previous ||
    !current.disks.length ||
    previous.disks.length !== current.disks.length ||
    current.at <= previous.at
  )
    return {};
  let read = 0,
    write = 0;
  for (const disk of current.disks) {
    const before = previous.disks.find((d) => d.id === disk.id);
    if (!before || disk.read < before.read || disk.write < before.write) return {};
    read += disk.read - before.read;
    write += disk.write - before.write;
  }
  const seconds = (current.at - previous.at) / 1000;
  return { diskReadBytesPerSecond: read / seconds, diskWriteBytesPerSecond: write / seconds };
}
