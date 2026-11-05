import { createHash } from 'node:crypto';
import type { ClusterEffectiveLoad } from '../cluster/effective-load.js';
import { decodeClusterDevice } from '../cluster/device-id.js';
import { placementThresholds } from '../cluster/placement.js';
import type { Inventory } from './inventory.js';

export const B11307_DEVELOPMENT = {
  packageId: 'llama-cuda-development-b11307-validation',
  upstreamCommit: '4453b535fd15cd5b9d5ccb956ebd38dc325c98fc',
  artifact: 'b11307-win-x64-cuda12.4',
} as const;

export function admitsDevelopmentB11307(inventorySha256: string | undefined): boolean {
  return inventorySha256 === '8ff49bd2e7a09430a1a2b45cb01b429e825710ea34678fbebc24befac61484c8';
}

/** Callers must obtain the inventory from the existing verifier or installed capability. */
export function isDevelopmentB11307Inventory(inventory: Inventory): boolean {
  return (
    inventory.packageId === B11307_DEVELOPMENT.packageId &&
    admitsDevelopmentB11307(createHash('sha256').update(JSON.stringify(inventory)).digest('hex'))
  );
}

/** Used only for configuration defaults and history metadata. */
export function isDevelopmentB11307Provenance(
  provenance: Pick<Inventory, 'packageId' | 'upstreamCommit'>,
): boolean {
  return (
    provenance.packageId === B11307_DEVELOPMENT.packageId &&
    provenance.upstreamCommit === B11307_DEVELOPMENT.upstreamCommit
  );
}

const coordinatorGpu = 'gpu-22c23971-dacf-2123-2169-ad70d8f6729a';
const workerGpu = 'gpu-d42a520b-020b-2673-9923-6906e674e243';
export const B11307_WORKER_FIRST_LAYER = 31;

export function isDevelopmentB11307Device(id: string): boolean {
  const device = decodeClusterDevice(id);
  return device.uuid.toLowerCase() === (device.kind === 'local' ? coordinatorGpu : workerGpu);
}

/** The experimental build is admitted only for the verified Bonsai settings and placements. */
export function isQualifiedDevelopmentB11307Load(load: ClusterEffectiveLoad): boolean {
  if (
    load.artifact !== B11307_DEVELOPMENT.artifact ||
    load.modelSha256 !== '71d6871836886267f39f1ac69b1b1dd8a783970708d7a189960112ed02978901' ||
    load.blockCount !== 64 ||
    load.contextPerSlot !== 7680 ||
    load.slots !== 4 ||
    load.threads !== null ||
    load.batch !== 2048 ||
    load.microbatch !== 512 ||
    !load.flashAttention ||
    load.cacheK !== 'q8_0' ||
    load.cacheV !== 'q8_0' ||
    load.speculation?.enabled ||
    load.preferences?.argumentsEnabled ||
    load.preferences?.customTemplate ||
    load.preferences?.ropeBase.enabled ||
    load.preferences?.ropeScale.enabled
  )
    return false;
  const { orderedUuids, tensorSplit } = load.placement;
  if (
    orderedUuids[0]?.toLowerCase() !== coordinatorGpu ||
    tensorSplit.length !== orderedUuids.length
  )
    return false;
  if (orderedUuids.length === 1) return tensorSplit[0] === 1;
  if (orderedUuids.length !== 2) return false;
  try {
    const worker = decodeClusterDevice(orderedUuids[1]!);
    const boundary = placementThresholds(tensorSplit)[0]!;
    return (
      worker.kind === 'peer' &&
      worker.uuid.toLowerCase() === workerGpu &&
      Math.fround((B11307_WORKER_FIRST_LAYER - 1) / 65) < boundary &&
      boundary < Math.fround(B11307_WORKER_FIRST_LAYER / 65)
    );
  } catch {
    return false;
  }
}
