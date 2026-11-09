import type { PlannerReport } from '../runtime/preflight.js';
import type { RuntimePackageDescription } from './inventory.js';
/** Public trust anchor pinned to the bytes exported by the production publisher. */
export const APPROVED_RUNTIME_ROOTS: readonly Readonly<{ asset: string; sha256: string }>[] =
  Object.freeze([
    Object.freeze({
      asset: 'production-root-v1.json',
      sha256: '055cefc8ef6eb9906522514b8cebf8cc4d2e14deb9d40b3c8f90f54a796d886b',
    }),
  ]);
const MiB = 1048576;
const qualificationModel = '71d6871836886267f39f1ac69b1b1dd8a783970708d7a189960112ed02978901';
const qualificationGpu = 'GPU-d42a520b-020b-2673-9923-6906e674e243';
const qualificationConfiguration = Object.freeze({
  modelSha256: qualificationModel,
  contextPerSlot: 7680,
  slots: 4,
  gpuLayers: 999999,
  gpuDevice: qualificationGpu,
  cacheK: 'q8_0' as const,
  cacheV: 'q8_0' as const,
  seed: 7,
  temperature: 0.8,
});

/** Four concurrent 7,500-token prefills and same-slot reuse on RTX 4070 SUPER.
 * Host peak working sets were 6,190,821,376 bytes (CUDA) and 5,982,564,352 bytes
 * (Vulkan). The envelopes reserve over 512 MiB above both measured peaks.
 */
export const APPROVED_MEMORY_REPORTS: readonly PlannerReport[] = Object.freeze(
  [
    { artifact: 'b11306-cuda12.4-msvc14.44-dev1', backend: 'cuda' as const, hostScratch: 4096 },
    { artifact: 'b11306-vulkan-msvc14.44-dev1', backend: 'vulkan' as const, hostScratch: 4864 },
  ].map(({ artifact, backend, hostScratch }) =>
    Object.freeze({
      modelSha256: qualificationModel,
      artifact,
      backend,
      configuration: qualificationConfiguration,
      contextLimit: 262144,
      weights: Object.freeze({ ram: 171 * MiB, vram: 3447 * MiB }),
      kv: Object.freeze({ ram: MiB, vram: 1619 * MiB }),
      scratch: Object.freeze({ ram: hostScratch * MiB, vram: 513 * MiB }),
      serverCaches: Object.freeze({
        promptCacheMiB: 768,
        contextCheckpoints: 2,
        ram: (768 + 4 * 2 * 151 + 256) * MiB,
      }),
      uncertainty: null,
      deviceVram: Object.freeze([
        Object.freeze({ uuid: qualificationGpu, bytes: (3447 + 1619 + 513) * MiB }),
      ]),
    }),
  ),
);

export const APPROVED_RUNTIME_CATALOGS: readonly {
  readonly endpoints: { metadata: string; assets: string };
  readonly offers: readonly { build: RuntimePackageDescription; size: string }[];
}[] = Object.freeze([
  {
    endpoints: {
      metadata: 'https://haowern98.github.io/ModelLoom/',
      assets: 'https://github.com/haowern98/ModelLoom/releases/download/runtime-b11306/',
    },
    offers: [
      {
        build: {
          packageId: 'llama-cuda-development',
          artifact: 'b11306-cuda12.4-msvc14.44-dev1',
          version: 'b11306-dev14-speculation-tensor-cache-v1',
          platform: 'win32',
          arch: 'x64',
          backend: 'cuda',
          upstreamCommit: '4f31296a907d73f3409f720429bcf31111615d77',
        },
        size: '638 MiB',
      },
      {
        build: {
          packageId: 'llama-vulkan-development',
          artifact: 'b11306-vulkan-msvc14.44-dev1',
          version: 'b11306-dev2-tensor-cache-v1',
          platform: 'win32',
          arch: 'x64',
          backend: 'vulkan',
          upstreamCommit: '4f31296a907d73f3409f720429bcf31111615d77',
        },
        size: '35 MiB',
      },
    ],
  },
]);
