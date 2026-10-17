import { expect, it } from 'vitest';
import { autoPlace } from './auto-place.js';
import { resolveClusterLoad, clusterLoadArguments } from './effective-load.js';
import { parseClusterEstimate } from './estimate.js';
import { record } from '../model-configuration/test-fixtures.js';
import { clusterServerArguments } from '../hosts/runtime-arguments.js';
const a = 'GPU-12345678-1234-1234-1234-123456789abc',
  b = 'GPU-87654321-1234-1234-1234-123456789abc';
const saved = {
  id: '12345678-1234-4234-8234-123456789abc',
  name: 'Laptop',
  revision: 1,
  modelId: record().modelId,
  profileId: 'test',
  blockCount: 64,
  load: { defaults: record().load, cacheK: 'q8_0' as const, cacheV: 'q8_0' as const },
  runs: [
    { uuid: a, first: 0, last: 47 },
    { uuid: b, first: 48, last: 63 },
  ],
};
it('binds the complete tuple and exact ordered split without changing request sampling', () => {
  const load = resolveClusterLoad(saved, 'test-artifact');
  expect(clusterLoadArguments(load)).toContain('layer');
  const args = clusterServerArguments('E:\\model.gguf', load, 18080, 'private-key-file', 'model');
  expect(args.slice(args.indexOf('--fit'), args.indexOf('--fit') + 2)).toEqual(['--fit', 'off']);
  expect(args.filter((a) => a === '--ctx-size')).toHaveLength(1);
  expect(args).toContain('--no-context-shift');
  expect(args).toContain('CUDA0,CUDA1');
  expect(args).not.toContain('--temp');
  expect(load.fingerprint).toBe(
    resolveClusterLoad({ ...saved, name: 'Other', revision: 2 }, 'test-artifact').fingerprint,
  );
  expect(load.fingerprint).not.toBe(
    resolveClusterLoad(
      { ...saved, load: { ...saved.load, defaults: { ...saved.load.defaults, concurrency: 1 } } },
      'test-artifact',
    ).fingerprint,
  );
});
it('captures advanced settings in the fingerprint and closed native argument values', () => {
  const preferences = {
    ...record().preferences,
    ropeBase: { enabled: true, value: 1000000 },
    ropeScale: { enabled: true, value: 0.5 },
    reasoningBudget: { enabled: true, value: 128 },
    reasoningMessage: 'Finish now, please.',
    customTemplate: true,
    chatTemplate: '{{ messages[0].content }}\nAssistant: --host 0.0.0.0',
  };
  const configured = { ...saved, load: { ...saved.load, preferences } };
  const load = resolveClusterLoad(configured, 'test-artifact');
  const args = clusterServerArguments('E:\\model.gguf', load, 18080, 'private-key-file', 'model');
  for (const [flag, value] of [
    ['--rope-freq-base', '1000000'],
    ['--rope-freq-scale', '0.5'],
    ['--reasoning-budget', '128'],
    ['--reasoning-budget-message', preferences.reasoningMessage],
    ['--chat-template', preferences.chatTemplate],
  ] as const) {
    expect(args.slice(args.indexOf(flag), args.indexOf(flag) + 2)).toEqual([flag, value]);
    expect(args.filter((arg) => arg === flag)).toHaveLength(1);
  }
  expect(args).toContain('--jinja');
  expect(args.filter((arg) => arg === '--host')).toHaveLength(1);
  expect(args[args.indexOf('--host') + 1]).toBe('127.0.0.1');
  expect(args[args.indexOf('--api-key-file') + 1]).toBe('private-key-file');
  expect(load.fingerprint).not.toBe(
    resolveClusterLoad(
      {
        ...configured,
        load: {
          ...configured.load,
          preferences: { ...preferences, reasoningBudget: { enabled: true, value: 129 } },
        },
      },
      'test-artifact',
    ).fingerprint,
  );
});
it.each([
  {
    ...record().preferences,
    argumentsEnabled: true,
    argumentsText: '--host 0.0.0.0 --api-key stolen',
  },
  { ...record().preferences, overflow: 'rolling' as const },
  { ...record().preferences, overflow: 'truncate-middle' as const },
])('rejects unsupported preferences before compiling native arguments', (preferences) => {
  expect(() =>
    resolveClusterLoad({ ...saved, load: { ...saved.load, preferences } }, 'test-artifact'),
  ).toThrow('UNSUPPORTED_SETTING');
});
it('preserves an explicit f16 V cache with flash attention off and rejects incompatible q8 V', () => {
  const configured = {
    ...saved,
    load: {
      ...saved.load,
      defaults: { ...saved.load.defaults, flashAttention: false },
      cacheV: 'f16' as const,
    },
  };
  const load = resolveClusterLoad(configured, 'test-artifact');
  const args = clusterLoadArguments(load);
  expect(args[args.indexOf('--flash-attn') + 1]).toBe('off');
  expect(args[args.indexOf('--cache-type-v') + 1]).toBe('f16');
  expect(() =>
    resolveClusterLoad(
      { ...configured, load: { ...configured.load, cacheV: 'q8_0' } },
      'test-artifact',
    ),
  ).toThrow('UNSUPPORTED_SETTING');
});
it('tries all single GPUs before using the preferred native split as its first two-GPU cut', async () => {
  const seen: [number, string, number][] = [];
  const result = await autoPlace(
    65,
    [b, a],
    (runs) => {
      seen.push([runs.length, runs[0]!.uuid, runs[1]?.first ?? 0]);
      return Promise.resolve(runs.length === 2 ? { runs, pressure: 0.9 } : null);
    },
    new AbortController().signal,
    Date.now() + 120000,
    49,
  );
  expect(result.code).toBe('PROPOSED');
  expect(seen).toEqual([
    [1, a, 0],
    [1, b, 0],
    [2, a, 49],
  ]);
});
it('strictly parses rounded per-device components and rejects extra/duplicate output', () => {
  const load = resolveClusterLoad(saved, 'test-artifact');
  const text = 'CUDA0 100 20 30\nCUDA1 50 10 20\nHost 2 3 4';
  expect(parseClusterEstimate(Buffer.from(text), load).devices[0]?.model).toBe(101 * 1048576);
  for (const bad of [text + '\nnoise', text.replace('CUDA1', 'CUDA0'), text.slice(0, -2)])
    expect(() => parseClusterEstimate(Buffer.from(bad), load)).toThrow('INVALID_ESTIMATE');
});
it('prefers a single GPU and reports budget exhaustion separately from no fit', async () => {
  const signal = new AbortController().signal;
  const seen: number[] = [];
  const result = await autoPlace(
    64,
    [a, b],
    (runs) => {
      seen.push(runs.length);
      return Promise.resolve({ runs, pressure: 0.5 });
    },
    signal,
  );
  expect(result.code).toBe('PROPOSED');
  expect(seen).toEqual([1, 1]);
  expect((await autoPlace(64, [a, b], () => Promise.resolve(null), signal, 0)).code).toBe(
    'INCOMPLETE',
  );
});
it('checks both orders for two GPUs and cancellation never returns a partial proposal', async () => {
  const abort = new AbortController();
  let calls = 0;
  const result = await autoPlace(
    3,
    [a, b],
    (runs) => {
      calls++;
      return Promise.resolve(
        runs.length === 2 && runs[0]?.uuid === b ? { runs, pressure: 0.5 } : null,
      );
    },
    abort.signal,
  );
  expect(result.code).toBe('PROPOSED');
  expect(calls).toBe(4);
  expect(
    (
      await autoPlace(
        3,
        [a],
        (runs) => {
          abort.abort();
          return Promise.resolve({ runs, pressure: 0.1 });
        },
        abort.signal,
      )
    ).code,
  ).toBe('CANCELLED');
});
it('searches two-GPU cuts from the center, checking both orders before moving outward', async () => {
  const seen: [string, number][] = [];
  const result = await autoPlace(
    6,
    [b, a],
    (runs) => {
      if (runs.length === 2) seen.push([runs[0]!.uuid, runs[1]!.first]);
      return Promise.resolve(null);
    },
    new AbortController().signal,
  );
  expect(result.code).toBe('NO_FIT');
  expect(seen).toEqual(
    [3, 2, 4, 1, 5].flatMap((cut) => [
      [a, cut],
      [b, cut],
    ]),
  );
});
it('stops two-GPU search at the first feasible allocation while preserving single-GPU ranking', async () => {
  let calls = 0;
  const signal = new AbortController().signal;
  const single = await autoPlace(
    64,
    [a, b],
    (runs) => {
      calls++;
      return Promise.resolve({ runs, pressure: runs[0]!.uuid === b ? 0.2 : 0.7 });
    },
    signal,
  );
  expect(single).toEqual({ code: 'PROPOSED', runs: [{ uuid: b, first: 0, last: 63 }] });
  expect(calls).toBe(2);
  calls = 0;
  const split = await autoPlace(
    64,
    [a, b],
    (runs) => {
      calls++;
      return Promise.resolve(runs.length === 2 ? { runs, pressure: 0.9 } : null);
    },
    signal,
  );
  expect(split).toEqual({
    code: 'PROPOSED',
    runs: [
      { uuid: a, first: 0, last: 31 },
      { uuid: b, first: 32, last: 63 },
    ],
  });
  expect(calls).toBe(3);
});
it('checks cancellation and deadline after a feasible two-GPU estimate before returning it', async () => {
  const abort = new AbortController();
  expect(
    (
      await autoPlace(
        4,
        [a, b],
        (runs) => {
          if (runs.length === 2) abort.abort();
          return Promise.resolve(runs.length === 2 ? { runs, pressure: 0.5 } : null);
        },
        abort.signal,
      )
    ).code,
  ).toBe('CANCELLED');
  let now = 0;
  const originalNow = Date.now;
  Date.now = () => now;
  try {
    expect(
      (
        await autoPlace(
          4,
          [a, b],
          (runs) => {
            if (runs.length === 2) now = 10;
            return Promise.resolve(runs.length === 2 ? { runs, pressure: 0.5 } : null);
          },
          new AbortController().signal,
          10,
        )
      ).code,
    ).toBe('INCOMPLETE');
  } finally {
    Date.now = originalNow;
  }
});
