import { expect, it, vi } from 'vitest';
import path from 'node:path';
import { parseNvidiaMetrics, readNvidiaMetrics } from './nvidia-metrics';

const a = 'GPU-11111111-1111-1111-1111-111111111111';
const b = 'GPU-22222222-2222-2222-2222-222222222222';

it('preserves UUID identity and measured zero utilization while converting MiB to bytes', () => {
  expect(
    parseNvidiaMetrics(Buffer.from(`${b}, 0, 512, 16384, 15000\n${a}, 75, 1024, 6144, 4900`)),
  ).toEqual([
    {
      uuid: b,
      utilizationPercent: 0,
      usedMemoryBytes: 512 * 2 ** 20,
      totalMemoryBytes: 16384 * 2 ** 20,
      availableMemoryBytes: 15000 * 2 ** 20,
    },
    {
      uuid: a,
      utilizationPercent: 75,
      usedMemoryBytes: 1024 * 2 ** 20,
      totalMemoryBytes: 6144 * 2 ** 20,
      availableMemoryBytes: 4900 * 2 ** 20,
    },
  ]);
});

it('retains missing counters as unknown and rejects malformed identities and inconsistent memory', () => {
  expect(parseNvidiaMetrics(Buffer.from(`${a}, [N/A], [N/A], 6144, [N/A]`))).toEqual([
    { uuid: a, totalMemoryBytes: 6144 * 2 ** 20 },
  ]);
  for (const row of [
    `fake, 20, 10, 100, 50`,
    `${a}, 101, 10, 100, 50`,
    `${a}, 20, 101, 100, 50`,
    `${a}, 20, 10, 100, 101`,
    `${a}, 20, 10, 100, 50\n${a}, 30, 10, 100, 50`,
  ])
    expect(() => parseNvidiaMetrics(Buffer.from(row))).toThrow('INVALID_GPU_TELEMETRY');
});

it('uses a fixed hidden diagnostic query and propagates failure without fabricated readings', async () => {
  vi.stubEnv('SystemRoot', 'C:\\Windows');
  try {
    const run = vi.fn(() => Promise.resolve(Buffer.from(`${a}, 0, 0, 6144, 6000`)));
    expect((await readNvidiaMetrics(run))[0]?.utilizationPercent).toBe(0);
    expect(run.mock.calls[0]).toEqual([
      path.join('C:\\Windows', 'System32/nvidia-smi.exe'),
      [
        '--query-gpu=uuid,utilization.gpu,memory.used,memory.total,memory.free',
        '--format=csv,noheader,nounits',
      ],
    ]);
    await expect(readNvidiaMetrics(() => Promise.reject(Error('QUERY_FAILED')))).rejects.toThrow(
      'QUERY_FAILED',
    );
  } finally {
    vi.unstubAllEnvs();
  }
});
