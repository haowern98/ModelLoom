import type { PlannerReport } from '../runtime/preflight.js';
/** Disabled in ordinary builds. The explicit development build writes an ignored output module. */
export const DEVELOPMENT_BUILD: boolean = false;
export const DEVELOPMENT_ROOT = Object.freeze({
  asset: 'development-root.json',
  sha256: 'fa142094d12daccc01f8888051e97b6366d43c71f4e18583fa69c91734969f15',
});
/** Exact development envelopes: pinned planner, source cache bounds and bounded native runs.
 * See docs/runtime-bonsai-validation.md and docs/local-generation.md.
 * Estimates do not guarantee native allocation.
 * This is a physical RAM admission estimate, not a private-commit limit. Host loading
 * and cache growth have separate envelopes; full prompt capacity and two rounded-up
 * checkpoints per slot remain reserved. Each complete envelope exceeds its observed peak.
 */
export const DEVELOPMENT_MEMORY_REPORTS: readonly PlannerReport[] = Object.freeze([
  Object.freeze({
    modelSha256: '71d6871836886267f39f1ac69b1b1dd8a783970708d7a189960112ed02978901',
    artifact: 'b11306-cuda12.4-msvc14.44-dev1',
    backend: 'cuda' as const,
    configuration: Object.freeze({
      modelSha256: '71d6871836886267f39f1ac69b1b1dd8a783970708d7a189960112ed02978901',
      contextPerSlot: 7680,
      slots: 1,
      gpuLayers: 999999,
      gpuDevice: 'GPU-22c23971-dacf-2123-2169-ad70d8f6729a',
      cacheK: 'q8_0' as const,
      cacheV: 'q8_0' as const,
      seed: 7,
      temperature: 0.8,
    }),
    contextLimit: 262144,
    weights: Object.freeze({ ram: 171 * 1048576, vram: 3447 * 1048576 }),
    kv: Object.freeze({ ram: 1048576, vram: 405 * 1048576 }),
    scratch: Object.freeze({ ram: 5 * 2 ** 30, vram: 513 * 1048576 }),
    serverCaches: Object.freeze({
      promptCacheMiB: 768,
      contextCheckpoints: 2,
      ram: (768 + 2 * 151 + 256) * 1048576,
    }),
    uncertainty: null,
    deviceVram: Object.freeze([
      Object.freeze({
        uuid: 'GPU-22c23971-dacf-2123-2169-ad70d8f6729a',
        bytes: (3447 + 405 + 513) * 1048576,
      }),
    ]),
  }),
  // Oct 9 four-slot run: 6,210,097,152 resident peak bytes, four 7,500-token
  // prefills, per-slot reuse, RAM restoration and graceful exit. A 4 GiB host
  // allowance plus host weights covers the 3.86 GiB loading peak. Full cache
  // reserves bring admission to 6.35 GiB, over 512 MiB above the exercised peak.
  Object.freeze({
    modelSha256: '71d6871836886267f39f1ac69b1b1dd8a783970708d7a189960112ed02978901',
    artifact: 'b11306-cuda12.4-msvc14.44-dev1',
    backend: 'cuda' as const,
    configuration: Object.freeze({
      modelSha256: '71d6871836886267f39f1ac69b1b1dd8a783970708d7a189960112ed02978901',
      contextPerSlot: 7680,
      slots: 4,
      gpuLayers: 999999,
      gpuDevice: 'GPU-22c23971-dacf-2123-2169-ad70d8f6729a',
      cacheK: 'q8_0' as const,
      cacheV: 'q8_0' as const,
      seed: 7,
      temperature: 0.8,
    }),
    contextLimit: 262144,
    weights: Object.freeze({ ram: 171 * 1048576, vram: 3447 * 1048576 }),
    kv: Object.freeze({ ram: 1048576, vram: 1619 * 1048576 }),
    scratch: Object.freeze({ ram: 4 * 2 ** 30, vram: 513 * 1048576 }),
    serverCaches: Object.freeze({
      promptCacheMiB: 768,
      contextCheckpoints: 2,
      ram: (768 + 4 * 2 * 151 + 256) * 1048576,
    }),
    uncertainty: null,
    deviceVram: Object.freeze([
      Object.freeze({
        uuid: 'GPU-22c23971-dacf-2123-2169-ad70d8f6729a',
        bytes: (3447 + 1619 + 513) * 1048576,
      }),
    ]),
  }),
]);
