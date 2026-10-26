import { createHash } from 'node:crypto';
import type { Inventory } from '../runtime-package/inventory.js';
import type { GpuResource } from '../runtime/gpu-resources.js';
import { exact } from '../hosts/control.js';

export const RPC_RUNTIME_FILES = [
  'ggml-rpc-server.exe',
  'ggml.dll',
  'ggml-base.dll',
  'ggml-cpu-x64.dll',
  'ggml-cuda.dll',
  'ggml-rpc.dll',
  'cublas64_12.dll',
  'cublasLt64_12.dll',
  'cudart64_12.dll',
  'libomp.dll',
  'msvcp140.dll',
  'vcruntime140.dll',
  'vcruntime140_1.dll',
] as const;
export interface PeerResources {
  readonly runtimeId: string;
  readonly clientRuntimeId?: string;
  readonly ram: number;
  readonly gpus: readonly GpuResource[];
}
/** Includes the exact stock executable and all worker dependencies, independently
 * of a helper rebuild or metadata renewal. Neither build labels nor HELLO suffice. */
export function peerRuntimeId(inventory: Inventory): string {
  return runtimeFilesId(inventory, RPC_RUNTIME_FILES);
}

/** The coordinator does not contain the worker executable. Compare every shared
 * dependency separately so a partial RPC update cannot pass worker-only checks. */
export function rpcClientRuntimeId(inventory: Inventory): string {
  return runtimeFilesId(
    inventory,
    RPC_RUNTIME_FILES.filter((name) => name !== 'ggml-rpc-server.exe'),
  );
}

function runtimeFilesId(inventory: Inventory, names: readonly string[]): string {
  const files = names.map((name) => {
    const matches = inventory.files.filter((file) => file.path === name);
    if (matches.length !== 1) throw Error('RPC_PACKAGE_REQUIRED');
    return matches[0]!;
  });
  if (
    inventory.protocol !== 1 ||
    inventory.backend !== 'cuda' ||
    inventory.upstreamCommit !== '4f31296a907d73f3409f720429bcf31111615d77'
  )
    throw Error('RPC_PACKAGE_REQUIRED');
  return createHash('sha256')
    .update(
      JSON.stringify({ protocol: inventory.protocol, upstream: inventory.upstreamCommit, files }),
    )
    .digest('hex');
}

/** Preserve exact worker identity, and require coordinator evidence for the new
 * cache protocol. Legacy reports remain usable only with the legacy package. */
export function requireCompatibleRpcRuntime(
  coordinator: Inventory,
  local: PeerResources,
  remote: PeerResources,
): void {
  if (
    local.runtimeId !== remote.runtimeId ||
    local.clientRuntimeId !== remote.clientRuntimeId ||
    (local.clientRuntimeId !== undefined &&
      local.clientRuntimeId !== rpcClientRuntimeId(coordinator)) ||
    (coordinator.version.endsWith('-tensor-cache-v1') && local.clientRuntimeId === undefined)
  )
    throw Error('INCOMPATIBLE_RUNTIME');
}

/** Bounded selected-GPU observations across the authenticated management channel. */
export function decodePeerResources(input: unknown): PeerResources {
  const bad = (): never => {
    throw Error('NEEDS_RESOURCE_EVIDENCE');
  };
  const object = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : bad();
  const value = object(input);
  exact(value, [
    'runtimeId',
    'ram',
    'gpus',
    ...(Object.hasOwn(value, 'clientRuntimeId') ? ['clientRuntimeId'] : []),
  ]);
  const integer = (n: unknown): number =>
    Number.isSafeInteger(n) && Number(n) >= 0 ? (n as number) : bad();
  if (
    typeof value.runtimeId !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(value.runtimeId) ||
    (Object.hasOwn(value, 'clientRuntimeId') &&
      (typeof value.clientRuntimeId !== 'string' ||
        !/^[a-f0-9]{64}$/u.test(value.clientRuntimeId))) ||
    !Array.isArray(value.gpus) ||
    value.gpus.length > 16
  )
    return bad();
  const gpus = value.gpus.map((entry): GpuResource => {
    const gpu = object(entry);
    exact(gpu, ['uuid', 'bus', 'driver', 'total', 'free', 'mig', 'driverModel']);
    if (
      typeof gpu.uuid !== 'string' ||
      !/^GPU-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(gpu.uuid) ||
      typeof gpu.bus !== 'string' ||
      !/^[a-f0-9]{8}:[a-f0-9]{2}:[a-f0-9]{2}\.[0-7]$/iu.test(gpu.bus) ||
      typeof gpu.driver !== 'string' ||
      !/^\d{1,3}(?:\.\d{1,3}){1,3}$/u.test(gpu.driver) ||
      !['[N/A]', 'Disabled', 'Enabled'].includes(String(gpu.mig)) ||
      !['WDDM', 'TCC', 'MCDM'].includes(String(gpu.driverModel))
    )
      return bad();
    const total = integer(gpu.total),
      free = integer(gpu.free);
    if (free > total) return bad();
    return Object.freeze({
      uuid: gpu.uuid,
      bus: gpu.bus,
      driver: gpu.driver,
      total,
      free,
      mig: gpu.mig as GpuResource['mig'],
      driverModel: gpu.driverModel as GpuResource['driverModel'],
    });
  });
  if (new Set(gpus.map((gpu) => gpu.uuid.toLowerCase())).size !== gpus.length) return bad();
  return Object.freeze({
    runtimeId: value.runtimeId,
    ...(typeof value.clientRuntimeId === 'string'
      ? { clientRuntimeId: value.clientRuntimeId }
      : {}),
    ram: integer(value.ram),
    gpus: Object.freeze(gpus),
  });
}
