import { createHash } from 'node:crypto';
import { decodeSavedClusterConfiguration } from './contracts.js';
import type { SavedClusterConfiguration, CompiledPlacement } from './contracts.js';
import { compilePlacement } from './placement.js';
import { SERVER_CACHE_POLICY } from '../runtime/preflight.js';
import type { AdvancedPreferences } from '../model-configuration/contracts.js';
/** Complete load tuple; request sampling remains in the existing generation owner. */
export interface ClusterEffectiveLoad {
  readonly version: 1;
  readonly modelSha256: string;
  readonly artifact: string;
  readonly contextPerSlot: number;
  readonly slots: number;
  readonly threads: number | null;
  readonly batch: number;
  readonly microbatch: number;
  readonly flashAttention: boolean;
  readonly preferences?: AdvancedPreferences;
  readonly cacheK: 'f16' | 'q8_0';
  readonly cacheV: 'f16' | 'q8_0';
  readonly blockCount: number;
  readonly placement: CompiledPlacement;
  readonly serverCaches: typeof SERVER_CACHE_POLICY;
  readonly fingerprint: string;
}
export function resolveClusterLoad(
  input: SavedClusterConfiguration,
  artifact: string,
): ClusterEffectiveLoad {
  const saved = decodeSavedClusterConfiguration(input),
    d = saved.load.defaults;
  if (
    !/^[A-Za-z0-9_.-]{1,128}$/u.test(artifact) ||
    d.automatic ||
    !Number.isSafeInteger(d.contextLength * d.concurrency) ||
    d.contextLength * d.concurrency > 2147483647
  )
    throw Error('NEEDS_RESOURCE_EVIDENCE');
  const preferences = saved.load.preferences;
  if (!d.flashAttention && saved.load.cacheV !== 'f16') throw Error('UNSUPPORTED_SETTING');
  if (
    preferences &&
    (preferences.argumentsEnabled ||
      (preferences.customTemplate && !preferences.chatTemplate.trim()))
  )
    throw Error('UNSUPPORTED_SETTING');
  const tuple = {
    version: 1 as const,
    modelSha256: saved.modelId,
    artifact,
    contextPerSlot: d.contextLength,
    slots: d.concurrency,
    threads: d.threads,
    batch: d.evaluationBatch,
    microbatch: d.physicalBatch,
    flashAttention: d.flashAttention,
    ...(preferences ? { preferences } : {}),
    cacheK: saved.load.cacheK,
    cacheV: saved.load.cacheV,
    blockCount: saved.blockCount,
    placement: compilePlacement(saved.runs, saved.blockCount),
    serverCaches: SERVER_CACHE_POLICY,
  };
  return Object.freeze({
    ...tuple,
    fingerprint: createHash('sha256').update(JSON.stringify(tuple)).digest('hex'),
  });
}
/** Shared fixed load flags for the server and fixed-setting estimator. */
export function clusterLoadArguments(load: ClusterEffectiveLoad): readonly string[] {
  return Object.freeze([
    '--ctx-size',
    String(load.contextPerSlot * load.slots),
    '--parallel',
    String(load.slots),
    '--batch-size',
    String(load.batch),
    '--ubatch-size',
    String(load.microbatch),
    ...(load.threads === null ? [] : ['--threads', String(load.threads)]),
    '--flash-attn',
    load.flashAttention ? 'on' : 'off',
    '--cache-type-k',
    load.cacheK,
    '--cache-type-v',
    load.cacheV,
    '--n-gpu-layers',
    String(load.blockCount + 1),
    '--device',
    load.placement.orderedUuids.map((_, i) => `CUDA${i}`).join(','),
    '--split-mode',
    load.placement.orderedUuids.length === 1 ? 'none' : 'layer',
    '--main-gpu',
    '0',
    '--tensor-split',
    load.placement.tensorSplit.join(','),
    ...(load.preferences?.ropeBase.enabled
      ? ['--rope-freq-base', String(load.preferences.ropeBase.value)]
      : []),
    ...(load.preferences?.ropeScale.enabled
      ? ['--rope-freq-scale', String(load.preferences.ropeScale.value)]
      : []),
  ]);
}
