import type { ClusterEffectiveLoad } from './effective-load.js';
import { clusterDeviceNames, decodeClusterDevice } from './device-id.js';

export type PhysicalPlacementDevice =
  | { readonly uuid: string; readonly pciBus: string; readonly rpcEndpoint?: never }
  | { readonly uuid: string; readonly rpcEndpoint: string; readonly pciBus?: never };
export type BlockCacheKind = 'kv' | 'recurrent' | 'auto' | 'none';
export interface StockAllocationObservation {
  readonly fingerprint: string;
  readonly blocks: readonly {
    readonly index: number;
    readonly uuid: string;
    readonly cache: BlockCacheKind;
  }[];
  readonly outputUuid: string;
  readonly inputBuffer: 'cpu';
}
/** Verify pinned b11306 debug startup allocation observations. The owner must supply
 * complete output and trusted model cache topology. This does not prove execution
 * placement or physical VRAM residency, and does not replace owned readiness. */
export function verifyStockPlacement(
  log: string,
  load: ClusterEffectiveLoad,
  physical: readonly PhysicalPlacementDevice[],
  cacheLayers: readonly BlockCacheKind[],
): StockAllocationObservation {
  const fail = (): never => {
    throw Error('PLACEMENT_MISMATCH');
  };
  const n = load.blockCount,
    ids = load.placement.orderedUuids;
  const pci = (s: string): string => {
    const m = /^(?:0{4})?([0-9a-f]{4}):([0-9a-f]{2}):([0-9a-f]{2})\.([0-7])$/iu.exec(s);
    return m ? m.slice(1).join(':').toLowerCase() : fail();
  };
  if (
    Buffer.byteLength(log, 'utf8') > 4194304 ||
    !log.endsWith('\n') ||
    log.includes('\u0000') ||
    log.includes('\ufffd') ||
    !Number.isSafeInteger(n) ||
    n < 1 ||
    n > 65536 ||
    ids.length < 1 ||
    ids.length > 2 ||
    cacheLayers.length !== n ||
    cacheLayers.some((k) => !['kv', 'recurrent', 'auto', 'none'].includes(k))
  )
    fail();
  const executed = cacheLayers.findIndex((k) => k === 'none');
  const executionCount = executed < 0 ? n : executed;
  if (executionCount < 1 || cacheLayers.slice(executionCount).some((k) => k !== 'none')) fail();
  const names = clusterDeviceNames(ids);
  const expectedIdentity = ids.map((id) => {
    const rows = physical.filter((p) => p.uuid.toLowerCase() === id.toLowerCase());
    if (rows.length !== 1) return fail();
    const row = rows[0]!;
    if (decodeClusterDevice(id).kind === 'local') return row.pciBus ? pci(row.pciBus) : fail();
    const match = /^127\.0\.0\.1:([1-9][0-9]{3,4})$/u.exec(row.rpcEndpoint ?? '');
    return match && Number(match[1]) >= 1024 && Number(match[1]) <= 65535
      ? row.rpcEndpoint!
      : fail();
  });
  if (new Set(expectedIdentity).size !== ids.length) fail();
  const device = (s: string): number => {
    const i = names.indexOf(s);
    return i >= 0 && i < ids.length ? i : fail();
  };
  const expected = (i: number): number => {
    if (ids.length === 1) return 0;
    const weights = load.placement.tensorSplit;
    const threshold = Math.fround(weights[0]! / Math.fround(weights[0]! + weights[1]!));
    return Math.fround(i / (n + 1)) < threshold ? 0 : 1;
  };
  const seenDevices = new Set<number>(),
    blocks = new Map<number, number>();
  const cache = {
    kv: new Map<number, number | null>(),
    recurrent: new Map<number, number | null>(),
  };
  const buffers = { model: new Set<number>(), kv: new Set<number>(), recurrent: new Set<number>() };
  let moved = false,
    offloaded = false,
    output = false,
    loaded = false;
  const unique = (set: Set<number>, i: number) => {
    if (set.has(i)) fail();
    set.add(i);
  };
  for (const line of log.split('\n')) {
    let m: RegExpExecArray | null;
    if (line.includes('llama_prepare_model_devices: using device')) {
      m =
        /llama_prepare_model_devices: using device ((?:CUDA|RPC)\d+) \(([^\r\n]*)\) \(([^()]+)\) - \d+ MiB free\s*$/u.exec(
          line,
        );
      if (!m) fail();
      const i = device(m![1]!);
      if (
        names[i]!.startsWith('RPC')
          ? m![2] !== expectedIdentity[i] || m![3] !== 'unknown id'
          : pci(m![3]!) !== expectedIdentity[i]
      )
        fail();
      unique(seenDevices, i);
    } else if (line.includes('load_tensors: layer')) {
      m = /load_tensors: layer\s+(\d+) assigned to device (\S+), is_swa = [01]\s*$/u.exec(line);
      if (!m) fail();
      const i = Number(m![1]),
        d = device(m![2]!);
      if (i > n || blocks.has(i) || d !== expected(i)) fail();
      blocks.set(i, d);
    } else if (line.includes('cannot be used with preferred buffer type')) {
      if (
        moved ||
        !(
          names.every((name) => name.startsWith('RPC'))
            ? /done_getting_tensors: tensor 'token_embd\.weight' \([A-Za-z0-9_]+\) \(and 0 others\) cannot be used with preferred buffer type CPU_REPACK, using CPU instead\s*$/u
            : /done_getting_tensors: tensor 'token_embd\.weight' \([A-Za-z0-9_]+\) \(and 0 others\) cannot be used with preferred buffer type CUDA_Host, using CPU instead\s*$/u
        ).test(line)
      )
        fail();
      moved = true;
    } else if (line.includes('load_tensors: offloaded')) {
      m = /load_tensors: offloaded (\d+)\/(\d+) layers to GPU\s*$/u.exec(line);
      if (offloaded || !m || Number(m[1]) !== n + 1 || Number(m[2]) !== n + 1) fail();
      offloaded = true;
    } else if (line.includes('load_tensors: offloading output layer')) {
      if (output || !line.trimEnd().endsWith('load_tensors: offloading output layer to GPU'))
        fail();
      output = true;
    } else if (/llama_(?:kv_cache|memory_recurrent)[:,] layer/u.test(line)) {
      m =
        /llama_(kv_cache|memory_recurrent)[:,] layer\s+(\d+): (?:dev = (\S+)|(filtered|skipped))\s*$/u.exec(
          line,
        );
      if (!m) fail();
      const kind = m![1] === 'kv_cache' ? 'kv' : 'recurrent',
        i = Number(m![2]);
      if (i >= n || cache[kind].has(i)) fail();
      const d = m![3] ? device(m![3]) : null;
      if (
        (cacheLayers[i] !== 'auto' && (cacheLayers[i] === kind) !== (d !== null)) ||
        (d !== null && d !== expected(i))
      )
        fail();
      if (d === null && m![4] !== (kind === 'kv' ? 'filtered' : 'skipped')) fail();
      cache[kind].set(i, d);
    } else if (
      (m =
        /(?:load_tensors:|llama_kv_cache:|llama_memory_recurrent:)\s+((?:CUDA|RPC)\d+(?:\[127\.0\.0\.1:\d+\])?) (model|KV|RS) buffer size =\s+(\d+(?:\.\d+)?) MiB\s*$/u.exec(
          line,
        ))
    ) {
      if (!(Number(m[3]) > 0)) fail();
      const bufferDevice = /^((?:CUDA|RPC)\d+)(?:\[([^\]]+)\])?$/u.exec(m[1]!);
      if (!bufferDevice) fail();
      const bufferIndex = device(bufferDevice![1]!);
      if (
        names[bufferIndex]!.startsWith('RPC') &&
        bufferDevice![2] !== expectedIdentity[bufferIndex]
      )
        fail();
      unique(buffers[m[2] === 'model' ? 'model' : m[2] === 'KV' ? 'kv' : 'recurrent'], bufferIndex);
    } else if (/(?:llama_kv_cache:|llama_memory_recurrent:).* (?:KV|RS) buffer size/u.test(line)) {
      // Any extra cache buffer outside the selected CUDA devices is a fallback.
      fail();
    } else if (line.includes('llama_server: model loaded')) {
      if (loaded) fail();
      loaded = true;
    }
  }
  if (
    !offloaded ||
    !output ||
    !loaded ||
    blocks.size !== n + 1 ||
    seenDevices.size !== ids.length ||
    buffers.model.size !== ids.length
  )
    fail();
  for (const kind of ['kv', 'recurrent'] as const) {
    if (cache[kind].size || cacheLayers.includes(kind)) {
      if (cache[kind].size !== n && cache[kind].size !== executionCount) fail();
      for (let i = 0; i < n; i++) if (!cache[kind].has(i) && i < executionCount) fail();
      for (const [i, d] of cache[kind]) if (d !== null && !buffers[kind].has(expected(i))) fail();
    } else if (cache[kind].size !== 0) fail();
  }
  for (let i = 0; i < n; i++) {
    const devices = [cache.kv.get(i), cache.recurrent.get(i)].filter((d) => d != null);
    if (devices.length !== (i < executionCount ? 1 : 0)) fail();
  }
  if (ids[expected(n)] !== load.placement.outputUuid) fail();
  return Object.freeze({
    fingerprint: load.fingerprint,
    blocks: Object.freeze(
      cacheLayers.map((kind, index) =>
        Object.freeze({
          index,
          uuid: ids[expected(index)]!,
          cache:
            kind === 'auto'
              ? cache.kv.get(index) != null
                ? ('kv' as const)
                : ('recurrent' as const)
              : kind,
        }),
      ),
    ),
    outputUuid: load.placement.outputUuid,
    inputBuffer: 'cpu',
  });
}
