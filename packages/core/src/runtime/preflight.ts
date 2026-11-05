/** Exact supported settings; contextPerSlot is tokens per native slot, not aggregate context. */
export interface RuntimeConfiguration {
  readonly modelSha256: string;
  readonly contextPerSlot: number;
  readonly slots: number;
  readonly gpuLayers: number;
  /** Full physical NVIDIA UUID for the supported single-GPU launch; omitted for CPU. */
  readonly gpuDevice?: string;
  readonly cacheK: 'f16' | 'q8_0';
  readonly cacheV: 'f16' | 'q8_0';
  readonly seed: number;
  readonly temperature: number;
}
/** Reviewed fixed server reuse policy. A cache limit is a peak budget, not eager allocation. */
export const SERVER_CACHE_POLICY = Object.freeze({ promptCacheMiB: 768, contextCheckpoints: 2 });
/** Validated estimates in bytes, bound to one model/build/backend/configuration. Uncertainty blocks admission. */
export interface PlannerReport {
  readonly modelSha256: string;
  readonly artifact: string;
  readonly backend: 'cpu' | 'cuda' | 'vulkan';
  readonly configuration: RuntimeConfiguration;
  readonly contextLimit: number;
  readonly weights: { readonly ram: number; readonly vram: number };
  readonly kv: { readonly ram: number; readonly vram: number };
  readonly scratch: { readonly ram: number; readonly vram: number };
  /** Separate validated peak for RAM prompt reuse, all per-slot checkpoints and cache overhead. */
  readonly serverCaches: {
    readonly promptCacheMiB: number;
    readonly contextCheckpoints: number;
    readonly ram: number;
  };
  readonly uncertainty: string | null;
  /** Validated placement in bytes per physical GPU UUID; aggregate VRAM alone cannot admit CUDA. */
  readonly deviceVram?: readonly { readonly uuid: string; readonly bytes: number }[];
}
export type Preflight = Readonly<{
  code:
    | 'NEEDS_RESOURCE_EVIDENCE'
    | 'INSUFFICIENT_RESOURCES'
    | 'INVALID_CONFIGURATION'
    | 'INCOMPATIBLE_DRIVER'
    | 'SHARED_GPU_MEMORY_CONFIRMATION'
    | 'ADMITTED';
  totalContext: number;
  ram: number | null;
  vram: number | null;
}>;
import { isDeepStrictEqual } from 'node:util';
/** Pure report validation, not launch authority. The broker also requires independently validated planner provenance. */
export function checkResources(
  configuration: RuntimeConfiguration,
  artifact: string,
  backend: 'cpu' | 'cuda' | 'vulkan',
  report: PlannerReport | undefined,
  available: { ram: number; vram: number },
): Preflight {
  const totalContext = configuration.contextPerSlot * configuration.slots;
  const result = (
    code: Preflight['code'],
    ram: number | null = null,
    vram: number | null = null,
  ): Preflight =>
    Object.freeze({
      code,
      totalContext: Number.isSafeInteger(totalContext) ? totalContext : 0,
      ram,
      vram,
    });
  if (
    !/^[a-f0-9]{64}$/u.test(configuration.modelSha256) ||
    !Number.isSafeInteger(configuration.contextPerSlot) ||
    configuration.contextPerSlot < 1 ||
    !Number.isSafeInteger(configuration.slots) ||
    configuration.slots < 1 ||
    !Number.isSafeInteger(totalContext) ||
    totalContext > 2_147_483_647 ||
    !Number.isSafeInteger(configuration.gpuLayers) ||
    configuration.gpuLayers < 0 ||
    (Object.hasOwn(configuration, 'gpuDevice') &&
      (configuration.gpuLayers === 0 ||
        typeof configuration.gpuDevice !== 'string' ||
        !/^GPU-[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}$/u.test(
          configuration.gpuDevice,
        ))) ||
    !Number.isSafeInteger(configuration.seed) ||
    configuration.seed < 0 ||
    configuration.seed > 4294967295 ||
    !Number.isFinite(configuration.temperature) ||
    configuration.temperature < 0 ||
    !['f16', 'q8_0'].includes(configuration.cacheK) ||
    !['f16', 'q8_0'].includes(configuration.cacheV)
  )
    return result('INVALID_CONFIGURATION');
  if (report && configuration.contextPerSlot > report.contextLimit)
    return result('INVALID_CONFIGURATION');
  if (
    !report ||
    report.modelSha256 !== configuration.modelSha256 ||
    report.artifact !== artifact ||
    report.backend !== backend ||
    report.uncertainty !== null ||
    !isDeepStrictEqual(report.configuration, configuration) ||
    !Number.isSafeInteger(report.contextLimit) ||
    report.contextLimit < 1
  )
    return result('NEEDS_RESOURCE_EVIDENCE');
  const amounts = [report.weights, report.kv, report.scratch];
  const caches = report.serverCaches;
  if (
    !caches ||
    caches.promptCacheMiB !== SERVER_CACHE_POLICY.promptCacheMiB ||
    caches.contextCheckpoints !== SERVER_CACHE_POLICY.contextCheckpoints ||
    !Number.isSafeInteger(caches.ram) ||
    caches.ram < SERVER_CACHE_POLICY.promptCacheMiB * 1048576 ||
    amounts.some(
      (part) =>
        !part ||
        !Number.isSafeInteger(part.ram) ||
        part.ram < 0 ||
        !Number.isSafeInteger(part.vram) ||
        part.vram < 0,
    )
  )
    return result('NEEDS_RESOURCE_EVIDENCE');
  const ram = amounts.reduce((sum, part) => sum + part.ram, caches.ram),
    vram = amounts.reduce((sum, part) => sum + part.vram, 0);
  if (
    !Number.isSafeInteger(ram) ||
    !Number.isSafeInteger(vram) ||
    ram === 0 ||
    !Number.isSafeInteger(available.ram) ||
    available.ram < 0 ||
    !Number.isSafeInteger(available.vram) ||
    available.vram < 0
  )
    return result('NEEDS_RESOURCE_EVIDENCE');
  return result(
    available.ram < ram || available.vram < vram ? 'INSUFFICIENT_RESOURCES' : 'ADMITTED',
    ram,
    vram,
  );
}
