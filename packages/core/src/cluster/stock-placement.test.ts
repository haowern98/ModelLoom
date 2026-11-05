import { describe, expect, it } from 'vitest';
import { verifyStockPlacement } from './stock-placement.js';
import type { ClusterEffectiveLoad } from './effective-load.js';
import { SERVER_CACHE_POLICY } from '../runtime/preflight.js';

const uuids = [
  'GPU-11111111-1111-1111-1111-111111111111',
  'GPU-22222222-2222-2222-2222-222222222222',
];
const load: ClusterEffectiveLoad = {
  version: 1,
  modelSha256: 'b'.repeat(64),
  artifact: 'stock-b11306',
  contextPerSlot: 1024,
  slots: 4,
  threads: null,
  batch: 512,
  microbatch: 256,
  flashAttention: true,
  cacheK: 'q8_0',
  cacheV: 'q8_0',
  serverCaches: SERVER_CACHE_POLICY,
  blockCount: 4,
  fingerprint: 'a'.repeat(64),
  placement: { orderedUuids: uuids, tensorSplit: [0.3, 0.7], outputUuid: uuids[1]! },
};
const physical = uuids.map((uuid, i) => ({ uuid, pciBus: `0000:0${i + 1}:00.0` }));
const caches = ['recurrent', 'kv', 'recurrent', 'kv'] as const;
const log = [
  ...physical.map(
    (p, i) =>
      `llama_prepare_model_devices: using device CUDA${i} (GPU name) (${p.pciBus}) - 100 MiB free`,
  ),
  ...Array.from(
    { length: 5 },
    (_, i) => `load_tensors: layer ${i} assigned to device CUDA${i < 2 ? 0 : 1}, is_swa = 0`,
  ),
  "done_getting_tensors: tensor 'token_embd.weight' (q1_0) (and 0 others) cannot be used with preferred buffer type CUDA_Host, using CPU instead",
  'load_tensors: offloading output layer to GPU',
  'load_tensors: offloaded 5/5 layers to GPU',
  ...[0, 1].map((i) => `load_tensors: CUDA${i} model buffer size = 100.00 MiB`),
  ...caches.flatMap((kind, i) => [
    `llama_kv_cache: layer ${i}: ${kind === 'kv' ? `dev = CUDA${i < 2 ? 0 : 1}` : 'filtered'}`,
    kind === 'recurrent'
      ? `llama_memory_recurrent, layer ${i}: dev = CUDA${i < 2 ? 0 : 1}`
      : `llama_memory_recurrent: layer ${i}: skipped`,
  ]),
  ...[0, 1].flatMap((i) => [
    `llama_kv_cache: CUDA${i} KV buffer size = 10.00 MiB`,
    `llama_memory_recurrent: CUDA${i} RS buffer size = 10.00 MiB`,
  ]),
  'srv llama_server: model loaded',
  '',
].join('\n');
describe('stock allocation observations', () => {
  it('verifies Vulkan ordinals against the selected physical PCI devices', () => {
    const vulkanLoad = { ...load, artifact: 'b11306-vulkan-msvc14.44-dev1' };
    const vulkanLog = log.replaceAll('CUDA', 'Vulkan');
    expect(verifyStockPlacement(vulkanLog, vulkanLoad, physical, caches).blocks).toHaveLength(4);
    expect(() =>
      verifyStockPlacement(
        vulkanLog.replace('0000:01:00.0', '0000:03:00.0'),
        vulkanLoad,
        physical,
        caches,
      ),
    ).toThrow('PLACEMENT_MISMATCH');
  });
  it('binds remote allocation rows to the owned gateway and qualified peer GPU', () => {
    const remote = `peer:${'a'.repeat(64)}:${uuids[1]}`;
    const distributed = {
      ...load,
      placement: { ...load.placement, orderedUuids: [uuids[0]!, remote], outputUuid: remote },
    };
    const remoteLog = log
      .replace(`CUDA1 (GPU name) (${physical[1]!.pciBus})`, 'RPC0 (127.0.0.1:49310) (unknown id)')
      .replaceAll('CUDA1 model buffer', 'RPC0[127.0.0.1:49310] model buffer')
      .replaceAll('CUDA1 KV buffer', 'RPC0[127.0.0.1:49310] KV buffer')
      .replaceAll('CUDA1 RS buffer', 'RPC0[127.0.0.1:49310] RS buffer')
      .replaceAll('CUDA1', 'RPC0');
    const topology = [physical[0]!, { uuid: remote, rpcEndpoint: '127.0.0.1:49310' }];
    expect(verifyStockPlacement(remoteLog, distributed, topology, caches).outputUuid).toBe(remote);
    expect(() =>
      verifyStockPlacement(remoteLog.replaceAll('49310', '49311'), distributed, topology, caches),
    ).toThrow('PLACEMENT_MISMATCH');
    expect(() => verifyStockPlacement(remoteLog, distributed, physical, caches)).toThrow(
      'PLACEMENT_MISMATCH',
    );
  });
  it('derives ordinary dense or hybrid cache ownership from complete observed rows', () => {
    expect(
      verifyStockPlacement(log, load, physical, ['auto', 'auto', 'auto', 'auto']).blocks.map(
        (block) => block.cache,
      ),
    ).toEqual(caches);
    const doubleCache = log.replace(
      'llama_kv_cache: layer 0: filtered',
      'llama_kv_cache: layer 0: dev = CUDA0',
    );
    expect(() =>
      verifyStockPlacement(doubleCache, load, physical, ['auto', 'auto', 'auto', 'auto']),
    ).toThrow('PLACEMENT_MISMATCH');
  });
  it('checks 65 allocated Qwen blocks and output with 64 ordinary inference cache layers', () => {
    const qwen = {
      ...load,
      blockCount: 65,
      placement: { orderedUuids: uuids, tensorSplit: [0.5, 0.5], outputUuid: uuids[1]! },
    };
    const device = (index: number) => (index < 33 ? 0 : 1);
    const qwenLog = [
      ...physical.map(
        (p, i) =>
          `llama_prepare_model_devices: using device CUDA${i} (GPU name) (${p.pciBus}) - 100 MiB free`,
      ),
      ...Array.from(
        { length: 66 },
        (_, i) => `load_tensors: layer ${i} assigned to device CUDA${device(i)}, is_swa = 0`,
      ),
      'load_tensors: offloading output layer to GPU',
      'load_tensors: offloaded 66/66 layers to GPU',
      ...[0, 1].map((i) => `load_tensors: CUDA${i} model buffer size = 100.00 MiB`),
      ...Array.from(
        { length: 65 },
        (_, i) =>
          `llama_kv_cache: layer ${i}: ${i < 64 && i % 4 === 3 ? `dev = CUDA${device(i)}` : 'filtered'}`,
      ),
      ...Array.from(
        { length: 64 },
        (_, i) =>
          `llama_memory_recurrent: layer ${i}: ${i % 4 !== 3 ? `dev = CUDA${device(i)}` : 'skipped'}`,
      ),
      ...[0, 1].flatMap((i) => [
        `llama_kv_cache: CUDA${i} KV buffer size = 10.00 MiB`,
        `llama_memory_recurrent: CUDA${i} RS buffer size = 10.00 MiB`,
      ]),
      'srv llama_server: model loaded',
      '',
    ].join('\n');
    const topology = [...Array.from({ length: 64 }, () => 'auto' as const), 'none' as const];
    const observation = verifyStockPlacement(qwenLog, qwen, physical, topology);
    expect(observation.outputUuid).toBe(uuids[1]);
    expect(observation.blocks.filter((block) => block.cache === 'kv')).toHaveLength(16);
    expect(observation.blocks.filter((block) => block.cache === 'recurrent')).toHaveLength(48);
    expect(() =>
      verifyStockPlacement(
        qwenLog.replace(
          'llama_kv_cache: layer 64: filtered',
          'llama_kv_cache: layer 64: dev = CUDA1',
        ),
        qwen,
        physical,
        topology,
      ),
    ).toThrow('PLACEMENT_MISMATCH');
    expect(() =>
      verifyStockPlacement(
        qwenLog.replace(/llama_memory_recurrent: layer 0:[^\n]+\n/u, ''),
        qwen,
        physical,
        topology,
      ),
    ).toThrow('PLACEMENT_MISMATCH');
  });
  it('checks physical mapping, every block, output and mixed caches', () => {
    expect(verifyStockPlacement(log, load, physical, caches).blocks.map((b) => b.uuid)).toEqual([
      uuids[0],
      uuids[0],
      uuids[1],
      uuids[1],
    ]);
  });
  it.each([
    ['PCI mismatch', log.replace('0000:01:00.0', '0000:03:00.0')],
    [
      'wrong block',
      log.replace('layer 1 assigned to device CUDA0', 'layer 1 assigned to device CUDA1'),
    ],
    ['duplicate block', log + 'load_tensors: layer 0 assigned to device CUDA0, is_swa = 0\n'],
    ['missing block', log.replace(/load_tensors: layer 1 assigned[^\n]+\n/u, '')],
    [
      'wrong cache',
      log.replace('llama_kv_cache: layer 1: dev = CUDA0', 'llama_kv_cache: layer 1: dev = CPU'),
    ],
    ['missing cache', log.replace(/llama_memory_recurrent, layer 0:[^\n]+\n/u, '')],
    ['extra fallback', log.replace('(and 0 others)', '(and 1 others)')],
    ['incomplete offload', log.replace('offloaded 5/5', 'offloaded 4/5')],
    ['truncated', log.slice(0, -1)],
    ['missing readiness', log.replace('srv llama_server: model loaded', '')],
    ['missing buffer', log.replace('llama_kv_cache: CUDA1 KV buffer size = 10.00 MiB', '')],
  ])('rejects %s', (_, text) =>
    expect(() => verifyStockPlacement(text, load, physical, caches)).toThrow('PLACEMENT_MISMATCH'),
  );
  it('bounds startup output', () =>
    expect(() => verifyStockPlacement('x'.repeat(4194305), load, physical, caches)).toThrow());
});
