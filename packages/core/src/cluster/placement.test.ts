import { expect, test } from 'vitest';
import assert from 'node:assert/strict';
import { compilePlacement, validateAssignment } from './placement.js';
import { decodeClusterDraft } from './contracts.js';

const a = 'GPU-11111111-1111-1111-1111-111111111111';
const b = 'GPU-22222222-2222-2222-2222-222222222222';
export const load = {
  defaults: {
    automatic: false,
    contextLength: 4096,
    threads: null,
    evaluationBatch: 512,
    physicalBatch: 128,
    concurrency: 1,
    flashAttention: true,
  },
  cacheK: 'f16',
  cacheV: 'f16',
};
const draft = (runs: unknown) =>
  decodeClusterDraft({
    key: 'draft',
    configurationId: null,
    modelId: 'a'.repeat(64),
    revision: 0,
    baseSavedRevision: null,
    load,
    runs,
  });

function simulate(ratios: readonly number[], n: number) {
  const weights = ratios.map((x) => Math.fround(Number(String(x))));
  let sum = 0;
  const splits = weights.map((x) => (sum = Math.fround(sum + x)));
  const normalized = splits.map((x) => Math.fround(x / sum));
  return Array.from({ length: n + 1 }, (_, i) =>
    normalized.findIndex((x) => Math.fround(i / (n + 1)) < x),
  );
}
test('every legal cut maps repeating blocks and output with pinned float32 rules', () => {
  for (let n = 2; n <= 256; n++)
    for (let cut = 1; cut < n; cut++) {
      const result = compilePlacement(
        [
          { uuid: b, first: cut, last: n - 1 },
          { uuid: a, first: 0, last: cut - 1 },
        ],
        n,
      );
      const label = `blocks=${n}, cut=${cut}`;
      assert.deepEqual(result.orderedUuids, [a, b], label);
      assert.equal(result.outputUuid, b, label);
      assert.deepEqual(
        simulate(result.tensorSplit, n),
        [...Array.from({ length: cut }, () => 0), ...Array.from({ length: n + 1 - cut }, () => 1)],
        label,
      );
    }
});
test('single GPU includes output for one or 64 blocks', () => {
  for (const n of [1, 64])
    expect(
      simulate(compilePlacement([{ uuid: a, first: 0, last: n - 1 }], n).tensorSplit, n),
    ).toEqual(Array(n + 1).fill(0));
});

test('qualified peer GPUs preserve single-device and mixed-device placement', () => {
  const peer = `peer:${'a'.repeat(64)}:${a}`;
  const single = compilePlacement([{ uuid: peer, first: 0, last: 35 }], 36);
  expect(single.orderedUuids).toEqual([peer]);
  expect(single.outputUuid).toBe(peer);
  expect(simulate(single.tensorSplit, 36)).toEqual(Array(37).fill(0));
  const mixed = compilePlacement(
    [
      { uuid: a, first: 0, last: 17 },
      { uuid: peer, first: 18, last: 35 },
    ],
    36,
  );
  expect(mixed.orderedUuids).toEqual([a, peer]);
  expect(simulate(mixed.tensorSplit, 36)).toEqual([
    ...Array.from({ length: 18 }, () => 0),
    ...Array.from({ length: 19 }, () => 1),
  ]);
  expect(() => compilePlacement([{ uuid: `peer:bad:${a}`, first: 0, last: 35 }], 36)).toThrow();
});
test.each(['', '-', '1e2', '1.5'])('retains raw %s but rejects assignment', (first) => {
  const value = draft([{ uuid: a, first, last: '63' }]);
  expect(value.runs[0]?.first).toBe(first);
  expect(validateAssignment(value, 64).ok).toBe(false);
});
test.each([
  [10, 2, 3, 63],
  [0, 40, 40, 63],
  [0, 30, 32, 63],
])('rejects reversed, overlap, gap', (first, last, next, end) => {
  expect(
    validateAssignment(
      draft([
        { uuid: a, first: String(first), last: String(last) },
        { uuid: b, first: String(next), last: String(end) },
      ]),
      64,
    ).ok,
  ).toBe(false);
});
test.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1, 16777216])(
  'rejects unsupported count %s promptly',
  (n) => {
    expect(() => compilePlacement([{ uuid: a, first: 0, last: n - 1 }], n)).toThrow();
  },
);
