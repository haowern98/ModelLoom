import { expect, test } from 'vitest';
import { decodeClusterReply } from './wire.js';
import {
  decodeClusterDraft,
  decodeConfigurationName,
  decodeCapturedClusterLoad,
  decodeClusterEdit,
  decodeSavedClusterConfiguration,
} from './contracts.js';
const load = {
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
test('accepts empty drafts and freezes detached load', () => {
  const result = decodeClusterDraft({
    key: 'draft',
    configurationId: null,
    modelId: 'a'.repeat(64),
    revision: 0,
    baseSavedRevision: null,
    load,
    runs: [],
  });
  expect(result.runs).toEqual([]);
  expect(Object.isFrozen(result.load.defaults)).toBe(true);
});
test.each(['', 'a'.repeat(129), 'line\nfeed', '\ud800'])('rejects invalid name', (name) =>
  expect(() => decodeConfigurationName(name)).toThrow(),
);
test('bounds UTF8 bytes and preserves name exactly', () => {
  expect(decodeConfigurationName(' 名称 ')).toBe(' 名称 ');
  expect(() => decodeConfigurationName('名'.repeat(43))).toThrow();
});
test('strict load fields and ranges', () => {
  expect(() => decodeCapturedClusterLoad({ ...load, args: [] })).toThrow();
  expect(() =>
    decodeCapturedClusterLoad({ ...load, defaults: { ...load.defaults, physicalBatch: 513 } }),
  ).toThrow();
  expect(() => decodeCapturedClusterLoad({ ...load, cacheK: 'q4_0' })).toThrow();
});
const uuid = 'GPU-11111111-1111-1111-1111-111111111111';
const edit = { modelId: 'a'.repeat(64), load, runs: [{ uuid, first: '', last: '-' }] };

test('retains detached presentation geometry without changing execution assignments', () => {
  const peer = `peer:${'b'.repeat(64)}`;
  const canvas = {
    positions: { local: { column: 0, row: 0 }, [peer]: { column: 0, row: 1 } },
    links: [{ from: 'local', to: peer, edge: 'bottom' }],
  };
  const decoded = decodeClusterEdit({ ...edit, canvas });
  expect(decoded.canvas).toEqual(canvas);
  expect(decoded.runs).toEqual(edit.runs);
  expect(Object.isFrozen(decoded.canvas?.positions.local)).toBe(true);
  canvas.positions.local.row = 3;
  expect(decoded.canvas?.positions.local?.row).toBe(0);
});

test.each([
  { positions: { local: { column: Infinity, row: 0 } }, links: [] },
  { positions: { local: { column: 1000000, row: 0 } }, links: [] },
  { positions: { '../path': { column: 0, row: 0 } }, links: [] },
  {
    positions: { local: { column: 0, row: 0 } },
    links: [{ from: 'local', to: 'missing', edge: 'right' }],
  },
  {
    positions: { local: { column: 0, row: 0 } },
    links: [{ from: 'local', to: 'local', edge: 'right' }],
  },
])('rejects malformed or unbounded canvas geometry', (canvas) => {
  expect(() => decodeClusterEdit({ ...edit, canvas })).toThrow('INVALID_CLUSTER_CONFIGURATION');
});

test('rejects cycles, overlapping cells, extra fields and oversized canvas records', () => {
  const peer = `peer:${'b'.repeat(64)}`;
  const positions = { local: { column: 0, row: 0 }, [peer]: { column: 1, row: 0 } };
  for (const canvas of [
    {
      positions,
      links: [
        { from: 'local', to: peer, edge: 'right' },
        { from: peer, to: 'local', edge: 'left' },
      ],
    },
    { positions: { ...positions, [peer]: positions.local }, links: [] },
    { positions, links: [], runtimePath: 'untrusted' },
    {
      positions: Object.fromEntries(
        Array.from({ length: 33 }, (_, index) => [
          `peer:${index.toString(16).padStart(64, '0')}`,
          { column: index, row: 0 },
        ]),
      ),
      links: [],
    },
  ])
    expect(() => decodeClusterEdit({ ...edit, canvas })).toThrow('INVALID_CLUSTER_CONFIGURATION');
});

test('returns field errors for qualified peer GPU assignments without losing their identity', () => {
  const issue = { uuid: `peer:${'b'.repeat(64)}:${uuid}`, field: 'first', code: 'invalid-integer' };
  const reply = {
    ok: true,
    configurations: [],
    configuration: null,
    draft: null,
    load: null,
    issues: [issue],
  };
  expect(decodeClusterReply(reply)).toEqual(reply);
  expect(() =>
    decodeClusterReply({ ...reply, issues: [{ ...issue, uuid: `peer:bad:${uuid}` }] }),
  ).toThrow();
});
test('edit excludes internal identities and preserves bounded incomplete strings', () => {
  expect(decodeClusterEdit(edit).runs).toEqual(edit.runs);
  for (const extra of ['profileId', 'id', 'revision', 'key', 'path', 'arguments', 'receipt'])
    expect(() => decodeClusterEdit({ ...edit, [extra]: 'x' })).toThrow();
  expect(() =>
    decodeClusterEdit({ ...edit, runs: [{ uuid, first: '1'.repeat(65), last: '1' }] }),
  ).toThrow();
  expect(() => decodeClusterEdit({ ...edit, runs: [...edit.runs, ...edit.runs] })).toThrow();
  expect(() =>
    decodeClusterEdit({ ...edit, runs: [{ uuid: 'GPU-11111111', first: '0', last: '1' }] }),
  ).toThrow();
});
test('saved records require strict internal IDs and contiguous numeric runs', () => {
  const saved = {
    id: '11111111-1111-4111-8111-111111111111',
    name: '配置',
    revision: 1,
    modelId: edit.modelId,
    blockCount: 64,
    profileId: 'pinned_1',
    load,
    runs: [{ uuid, first: 0, last: 63 }],
  };
  expect(decodeSavedClusterConfiguration(saved)).toEqual(saved);
  for (const delta of [
    { id: '../../file' },
    { modelId: 'A'.repeat(64) },
    { revision: 1.5 },
    { blockCount: 0 },
    { profileId: '../runtime' },
    { runs: [{ uuid, first: 1, last: 63 }] },
    { runs: [{ uuid, first: '0', last: '63' }] },
    { path: 'x' },
  ])
    expect(() => decodeSavedClusterConfiguration({ ...saved, ...delta })).toThrow();
});
