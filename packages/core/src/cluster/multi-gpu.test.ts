import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { compilePlacement, validateAssignment } from './placement.js';
import { decodeClusterDraft, decodeSavedClusterConfiguration } from './contracts.js';
import { decodeClusterReply } from './wire.js';
import { resolveClusterLoad, clusterLoadArguments } from './effective-load.js';
import { verifyStockPlacement } from './stock-placement.js';
import { validatePlacementReceipt } from './placement-receipt.js';
import { requireStockClusterProfile } from './stock-profile.js';
import { clusterDeviceNames } from './device-id.js';
import { autoPlace } from './auto-place.js';
import { ModelConfigurationStore } from '../model-configuration/store.js';
import { capabilities, record } from '../model-configuration/test-fixtures.js';

const gpu = (i: number) => `GPU-${i.toString(16).padStart(8, '0')}-1111-1111-1111-111111111111`;
const ids = Array.from({ length: 16 }, (_, i) =>
  i < 2 ? gpu(i) : `peer:${'a'.repeat(64)}:${gpu(i)}`,
);
const captured = { defaults: record().load, cacheK: 'q8_0' as const, cacheV: 'q8_0' as const };
const runsFor = (count: number, total: number) => {
  let first = 0;
  return ids.slice(0, count).map((uuid, i) => {
    const size = Math.floor(total / count) + (i < total % count ? 1 : 0);
    const run = { uuid, first, last: first + size - 1 };
    first += size;
    return run;
  });
};
const savedFor = (count = 3, total = 113) => ({
  id: '12345678-1234-4234-8234-123456789abc',
  name: 'Cluster',
  revision: 1,
  modelId: record().modelId,
  blockCount: total,
  profileId: 'b11306-four-slot',
  load: captured,
  runs: runsFor(count, total),
});

it('preserves every block and output under native cumulative float32 rules across 3-16 GPUs', () => {
  for (const total of [16, 63, 64, 113, 257, 65536])
    for (let count = 3; count <= 16; count++) {
      const runs = runsFor(count, total);
      const placement = compilePlacement([...runs].reverse(), total);
      let sum = 0;
      const cumulative = placement.tensorSplit.map(
        (weight) => (sum = Math.fround(sum + Math.fround(Number(String(weight))))),
      );
      const thresholds = cumulative.map((value) => Math.fround(value / sum));
      for (let layer = 0; layer <= total; layer++) {
        const actual = thresholds.findIndex((value) => Math.fround(layer / (total + 1)) < value);
        const expected =
          layer === total
            ? count - 1
            : runs.findIndex((run) => layer >= run.first && layer <= run.last);
        if (actual !== expected) throw Error(`Wrong GPU at ${layer}/${total} across ${count}`);
      }
      expect(placement.outputUuid).toBe(runs.at(-1)!.uuid);
    }
  expect(() =>
    compilePlacement(runsFor(16, 16).concat({ uuid: gpu(99), first: 16, last: 16 }), 17),
  ).toThrow();
});

it('decodes multiple-GPU intent without accepting duplicate identities, gaps or injected fields', () => {
  const saved = decodeSavedClusterConfiguration(savedFor(16));
  const draft = decodeClusterDraft({
    key: `model:${saved.modelId}`,
    configurationId: null,
    modelId: saved.modelId,
    revision: 1,
    baseSavedRevision: null,
    load: captured,
    runs: saved.runs.map((run) => ({ ...run, first: String(run.first), last: String(run.last) })),
  });
  expect(validateAssignment(draft, 113).ok).toBe(true);
  const invalid = { ...draft, runs: draft.runs.map((run) => ({ ...run, first: '-', last: '-' })) };
  const result = validateAssignment(invalid, 113);
  expect(result.ok).toBe(false);
  if (!result.ok)
    expect(
      decodeClusterReply({
        ok: true,
        configurations: [saved],
        configuration: saved,
        draft: invalid,
        load: captured,
        issues: result.issues,
      }),
    ).toMatchObject({ issues: result.issues });
  expect(() =>
    decodeSavedClusterConfiguration({ ...saved, runs: [...saved.runs, saved.runs[0]] }),
  ).toThrow();
  expect(() => decodeSavedClusterConfiguration({ ...saved, path: 'untrusted' })).toThrow();
  expect(() =>
    decodeSavedClusterConfiguration({
      ...saved,
      runs: saved.runs.map((run, i) => (i === 1 ? { ...run, first: run.first + 1 } : run)),
    }),
  ).toThrow();
});

it('persists and reopens three-GPU assignments without dropping a remote run', async () => {
  const database = new DatabaseSync(':memory:');
  const store = new ModelConfigurationStore(
    database,
    () => {},
    () => true,
    capabilities,
    record().load,
  );
  try {
    await store.recordImport(record().modelId, 123, {
      modelId: record().modelId,
      file: 'E:\\Models\\fixture.gguf',
      name: 'Fixture',
      size: '4 GB',
      sizeBytes: 4000,
      modifiedMs: 1,
      architecture: 'llama',
      contextLimit: 32768,
      blockCount: 113,
      quantization: 'Q4_K_M',
      parameters: '4B',
    });
    const draft = store.cluster.writeDraft(`model:${record().modelId}`, null, {
      modelId: record().modelId,
      load: captured,
      runs: runsFor(3, 113).map((run) => ({
        ...run,
        first: String(run.first),
        last: String(run.last),
      })),
    });
    const saved = store.cluster.saveDraft(draft.key, draft.revision, 'Three GPUs');
    expect(saved.ok).toBe(true);
    if (saved.ok) expect(store.cluster.read(saved.configuration.id)?.runs).toEqual(runsFor(3, 113));
  } finally {
    database.close();
  }
});

it('verifies every device, block, cache and output in a mixed local/remote stock observation', () => {
  const saved = savedFor(3, 64);
  const load = resolveClusterLoad(saved, 'b11306-cuda12.4-msvc14.44-dev1');
  expect(requireStockClusterProfile(load).profileId).toBe('b11306-four-slot');
  const names = clusterDeviceNames(load.placement.orderedUuids);
  const expected = (layer: number) =>
    layer === 64 ? 2 : saved.runs.findIndex((run) => layer >= run.first && layer <= run.last);
  const physical = ids
    .slice(0, 3)
    .map((uuid, i) =>
      i < 2 ? { uuid, pciBus: `0000:0${i + 1}:00.0` } : { uuid, rpcEndpoint: '127.0.0.1:49310' },
    );
  const bufferName = (i: number) => (i < 2 ? names[i] : `${names[i]}[127.0.0.1:49310]`);
  const log = [
    ...physical.map(
      (device, i) =>
        `llama_prepare_model_devices: using device ${names[i]} (${i < 2 ? 'GPU name' : device.rpcEndpoint}) (${device.pciBus ?? 'unknown id'}) - 100 MiB free`,
    ),
    ...Array.from(
      { length: 65 },
      (_, i) => `load_tensors: layer ${i} assigned to device ${names[expected(i)]}, is_swa = 0`,
    ),
    'load_tensors: offloading output layer to GPU',
    'load_tensors: offloaded 65/65 layers to GPU',
    ...names.map((_, i) => `load_tensors: ${bufferName(i)} model buffer size = 100.00 MiB`),
    ...Array.from(
      { length: 64 },
      (_, i) => `llama_kv_cache: layer ${i}: dev = ${names[expected(i)]}`,
    ),
    ...names.map((_, i) => `llama_kv_cache: ${bufferName(i)} KV buffer size = 10.00 MiB`),
    'srv llama_server: model loaded',
    '',
  ].join('\n');
  expect(
    verifyStockPlacement(
      log,
      load,
      physical,
      Array.from({ length: 64 }, () => 'kv' as const),
    ).blocks.map((block) => block.uuid),
  ).toEqual(Array.from({ length: 64 }, (_, i) => ids[expected(i)]));
  expect(() =>
    verifyStockPlacement(
      log.replace('layer 43 assigned to device RPC0', 'layer 43 assigned to device CUDA0'),
      load,
      physical,
      Array.from({ length: 64 }, () => 'kv' as const),
    ),
  ).toThrow('PLACEMENT_MISMATCH');
  expect(() =>
    verifyStockPlacement(
      log,
      load,
      physical.slice(0, 2),
      Array.from({ length: 64 }, () => 'kv' as const),
    ),
  ).toThrow('PLACEMENT_MISMATCH');
  const receipt = {
    version: 1,
    pid: 123,
    artifact: load.artifact,
    modelSha256: load.modelSha256,
    fingerprint: load.fingerprint,
    orderedUuids: load.placement.orderedUuids,
    inputDevice: 'cpu',
    fallback: false,
    blocks: Array.from({ length: 64 }, (_, index) => ({
      index,
      deviceUuid: ids[expected(index)],
      tensorDevices: [ids[expected(index)]],
      cacheDeviceUuid: ids[expected(index)],
      executedDeviceUuid: ids[expected(index)],
    })),
    output: { deviceUuid: ids[2], tensorDevices: [ids[2]], executedDeviceUuid: ids[2] },
  };
  expect(validatePlacementReceipt(Buffer.from(JSON.stringify(receipt)), load, 123)).toBe(true);
  const args = clusterLoadArguments(load);
  expect(args[args.indexOf('--device') + 1]).toBe('CUDA0,CUDA1,RPC0');
  expect(args[args.indexOf('--tensor-split') + 1]?.split(',')).toHaveLength(3);
});

it('plans three GPUs only after checking singles and never returns an unestimated split', async () => {
  const seen: number[] = [];
  const result = await autoPlace(
    113,
    ids.slice(0, 3),
    (runs) => {
      seen.push(runs.length);
      return Promise.resolve(runs.length === 3 ? { runs, pressure: 0.7 } : null);
    },
    new AbortController().signal,
  );
  expect(result.code).toBe('PROPOSED');
  expect(seen.slice(0, 3)).toEqual([1, 1, 1]);
  if (result.code === 'PROPOSED') expect(result.runs.at(-1)?.last).toBe(112);
  expect(
    (
      await autoPlace(
        113,
        ids.slice(0, 3),
        () => Promise.resolve(null),
        new AbortController().signal,
      )
    ).code,
  ).toBe('INCOMPLETE');
  const abort = new AbortController();
  expect(
    (
      await autoPlace(
        113,
        ids.slice(0, 3),
        () => {
          abort.abort();
          return Promise.resolve(null);
        },
        abort.signal,
      )
    ).code,
  ).toBe('CANCELLED');
  expect(
    (
      await autoPlace(
        113,
        ids.slice(0, 3),
        () => Promise.resolve(null),
        new AbortController().signal,
        0,
      )
    ).code,
  ).toBe('INCOMPLETE');
});
