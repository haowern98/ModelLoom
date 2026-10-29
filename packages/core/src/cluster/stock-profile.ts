import type { ClusterEffectiveLoad } from './effective-load.js';
import type { CandidateEstimate, EstimateParts } from './estimate.js';
import type { ResourceSnapshot } from '../runtime/gpu-resources.js';
import { SERVER_CACHE_POLICY } from '../runtime/preflight.js';
import { decodeClusterDevice } from './device-id.js';
import { executionDevices } from '../speculative-decoding/execution.js';
import type { SpeculativeCompanion } from '../speculative-decoding/assets.js';

export interface StockClusterReport {
  readonly fingerprint: string;
  readonly artifact: string;
  readonly modelSha256: string;
  readonly hostBytes: number;
  readonly devices: readonly { readonly uuid: string; readonly bytes: number }[];
  readonly profileId: 'b11306-four-slot';
  readonly cacheLayers: readonly ('kv' | 'recurrent' | 'auto' | 'none')[];
  readonly companion?: SpeculativeCompanion;
}
const reports = new WeakMap<StockClusterReport, string>();
const mib = 1048576;
const validDevice = (id: string) => {
  try {
    decodeClusterDevice(id);
    return true;
  } catch {
    return false;
  }
};
const fail = (): never => {
  throw Error('NEEDS_RESOURCE_EVIDENCE');
};

/** Pinned stock-runtime argument family. Model identity and settings are not capacity gates. */
export function requireStockClusterProfile(
  load: ClusterEffectiveLoad,
): Pick<StockClusterReport, 'profileId' | 'cacheLayers'> {
  if (
    load.version !== 1 ||
    load.artifact !== 'b11306-cuda12.4-msvc14.44-dev1' ||
    !/^[a-f0-9]{64}$/u.test(load.modelSha256) ||
    !Number.isSafeInteger(load.blockCount) ||
    load.blockCount < 1 ||
    load.blockCount > 65536 ||
    !Number.isSafeInteger(load.contextPerSlot) ||
    load.contextPerSlot < 1 ||
    !Number.isSafeInteger(load.slots) ||
    load.slots < 1 ||
    load.slots > 1024 ||
    !Number.isSafeInteger(load.contextPerSlot * load.slots) ||
    load.contextPerSlot * load.slots > 2147483647 ||
    (load.threads !== null &&
      (!Number.isSafeInteger(load.threads) || load.threads < 1 || load.threads > 1024)) ||
    !Number.isSafeInteger(load.batch) ||
    load.batch < 1 ||
    load.batch > 2147483647 ||
    !Number.isSafeInteger(load.microbatch) ||
    load.microbatch < 1 ||
    load.microbatch > load.batch ||
    typeof load.flashAttention !== 'boolean' ||
    !['f16', 'q8_0'].includes(load.cacheK) ||
    !['f16', 'q8_0'].includes(load.cacheV) ||
    load.serverCaches.promptCacheMiB !== SERVER_CACHE_POLICY.promptCacheMiB ||
    load.serverCaches.contextCheckpoints !== SERVER_CACHE_POLICY.contextCheckpoints ||
    !/^[a-f0-9]{64}$/u.test(load.fingerprint) ||
    load.placement.orderedUuids.length < 1 ||
    load.placement.orderedUuids.length > 2 ||
    load.placement.orderedUuids.some((uuid) => !validDevice(uuid)) ||
    new Set(load.placement.orderedUuids.map((uuid) => uuid.toLowerCase())).size !==
      load.placement.orderedUuids.length
  )
    return fail();
  return Object.freeze({
    profileId: 'b11306-four-slot',
    cacheLayers: Object.freeze(Array.from({ length: load.blockCount }, () => 'auto' as const)),
  });
}

/** Conservative margin cross-checked against the bounded stock Windows runs in
 * cluster-stock-validation-2026-10-16.md. It is never an allocation guarantee. */
export function createStockClusterReport(
  load: ClusterEffectiveLoad,
  estimate: CandidateEstimate,
  nextnPredictLayers = 0,
  companion?: SpeculativeCompanion,
): StockClusterReport {
  const profile = requireStockClusterProfile(load),
    uuids = executionDevices(load);
  if (
    load.speculation?.enabled &&
    (!estimate.speculation?.initialized ||
      !estimate.speculation.hostBounded ||
      (load.speculation.proposer?.source.kind === 'asset' &&
        companion?.modelId !== load.speculation.proposer.source.modelId))
  )
    throw Error('NEEDS_SPECULATIVE_EVIDENCE');
  if (
    !Number.isSafeInteger(nextnPredictLayers) ||
    nextnPredictLayers < 0 ||
    nextnPredictLayers >= load.blockCount ||
    estimate.fingerprint !== load.fingerprint ||
    estimate.orderedUuids.length !== uuids.length ||
    estimate.devices.length !== uuids.length ||
    uuids.some((uuid, i) => estimate.orderedUuids[i] !== uuid || estimate.devices[i]?.uuid !== uuid)
  )
    return fail();
  const budget = (parts: EstimateParts, reserve: number): number => {
    const values = [parts.model, parts.context, parts.compute];
    if (values.some((value) => !Number.isSafeInteger(value) || value < 0)) return fail();
    const bytes = Math.ceil(values.reduce((a, b) => a + b, 0) * 1.15) + reserve;
    if (!Number.isSafeInteger(bytes) || bytes < reserve) return fail();
    return bytes;
  };
  const report = Object.freeze({
    fingerprint: load.fingerprint,
    artifact: load.artifact,
    modelSha256: load.modelSha256,
    hostBytes:
      budget(estimate.host, 512 * mib) +
      (load.speculation?.enabled ? load.serverCaches.promptCacheMiB * mib : 0),
    devices: Object.freeze(
      estimate.devices.map((device) =>
        Object.freeze({ uuid: device.uuid, bytes: budget(device, 256 * mib) }),
      ),
    ),
    ...profile,
    ...(companion ? { companion: Object.freeze({ ...companion }) } : {}),
    cacheLayers: Object.freeze(
      profile.cacheLayers.map((kind, i) =>
        i >= load.blockCount - nextnPredictLayers ? ('none' as const) : kind,
      ),
    ),
  });
  reports.set(report, JSON.stringify(load));
  return report;
}

export interface StockClusterAdmission {
  readonly code:
    | 'ADMITTED'
    | 'NEEDS_RESOURCE_EVIDENCE'
    | 'INSUFFICIENT_RESOURCES'
    | 'INCOMPATIBLE_DRIVER'
    | 'SHARED_GPU_MEMORY_CONFIRMATION';
  readonly sharedMemoryBytes: number;
}
/** Recheck the latest physical UUID/driver/free-memory snapshot immediately before launch. */
export function checkStockClusterResources(
  load: ClusterEffectiveLoad,
  report: StockClusterReport,
  snapshot: ResourceSnapshot,
  allowSharedMemory = false,
): StockClusterAdmission {
  const result = (
    code: StockClusterAdmission['code'],
    sharedMemoryBytes = 0,
  ): StockClusterAdmission => ({ code, sharedMemoryBytes });
  try {
    requireStockClusterProfile(load);
  } catch {
    return result('NEEDS_RESOURCE_EVIDENCE');
  }
  if (
    reports.get(report) !== JSON.stringify(load) ||
    report.fingerprint !== load.fingerprint ||
    report.artifact !== load.artifact ||
    report.modelSha256 !== load.modelSha256 ||
    report.devices.length !== executionDevices(load).length ||
    report.devices.some((device, i) => device.uuid !== executionDevices(load)[i]) ||
    snapshot.gpus === null ||
    snapshot.ram === null ||
    !Number.isSafeInteger(snapshot.ram) ||
    snapshot.ram < 0
  )
    return result('NEEDS_RESOURCE_EVIDENCE');
  let sharedMemoryBytes = 0;
  for (const budget of report.devices) {
    const matches = snapshot.gpus.filter(
      (gpu) => gpu.uuid.toLowerCase() === budget.uuid.toLowerCase(),
    );
    if (matches.length !== 1) return result('NEEDS_RESOURCE_EVIDENCE');
    const gpu = matches[0]!;
    if (
      gpu.free === null ||
      !Number.isSafeInteger(gpu.free) ||
      gpu.free < 0 ||
      gpu.total === null ||
      !Number.isSafeInteger(gpu.total) ||
      gpu.total < gpu.free ||
      !/^\d{1,3}(?:\.\d{1,3}){1,3}$/u.test(gpu.driver)
    )
      return result('NEEDS_RESOURCE_EVIDENCE');
    const driver = gpu.driver.split('.').map(Number);
    if (driver[0]! < 551 || (driver[0] === 551 && driver[1]! < 78))
      return result('INCOMPATIBLE_DRIVER');
    if (gpu.mig === 'Enabled') return result('INSUFFICIENT_RESOURCES');
    if (gpu.free < budget.bytes) sharedMemoryBytes += budget.bytes;
  }
  if ((sharedMemoryBytes || snapshot.ram < report.hostBytes + 1536 * mib) && !allowSharedMemory)
    return result('SHARED_GPU_MEMORY_CONFIRMATION', sharedMemoryBytes);
  return result('ADMITTED', sharedMemoryBytes);
}
