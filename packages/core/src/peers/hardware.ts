/** Display facts only. This snapshot grants no GPU reservation or native launch authority. */
export interface PeerHardware {
  os: string;
  architecture?: string;
  cpuName?: string;
  cpuCores?: number;
  threads?: number;
  installedRamBytes?: number;
  usableRamBytes?: number;
  availableRamBytes?: number;
  runtimeBackends?: readonly string[];
  sampledAt: number;
  gpus: readonly {
    id: string;
    name: string;
    memoryBytes: number;
    availableMemoryBytes?: number;
    driverVersion?: string;
  }[];
}
function invalid(): never {
  throw Error('INVALID_HARDWARE');
}
function shape(input: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !allowed.includes(key))
  )
    return invalid();
  return input as Record<string, unknown>;
}
function text(value: unknown, maximum = 256): string {
  if (
    typeof value !== 'string' ||
    !value.length ||
    value.length > maximum ||
    [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
  )
    return invalid();
  return value;
}
function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return invalid();
  return value;
}
/** Closed, size-bounded schema on both the authenticated network and parent IPC. */
export function decodePeerHardware(input: unknown): PeerHardware {
  const value = shape(input, [
    'os',
    'architecture',
    'cpuName',
    'cpuCores',
    'threads',
    'installedRamBytes',
    'usableRamBytes',
    'availableRamBytes',
    'runtimeBackends',
    'sampledAt',
    'gpus',
  ]);
  if (!Array.isArray(value.gpus) || value.gpus.length > 16) return invalid();
  const result: PeerHardware = {
    os: text(value.os),
    sampledAt: number(value.sampledAt),
    gpus: value.gpus.map((input) => {
      const gpu = shape(input, [
        'id',
        'name',
        'memoryBytes',
        'availableMemoryBytes',
        'driverVersion',
      ]);
      const result: PeerHardware['gpus'][number] = {
        id: text(gpu.id, 160),
        name: text(gpu.name, 160),
        memoryBytes: number(gpu.memoryBytes),
        ...(gpu.availableMemoryBytes !== undefined
          ? { availableMemoryBytes: number(gpu.availableMemoryBytes) }
          : {}),
        ...(gpu.driverVersion !== undefined ? { driverVersion: text(gpu.driverVersion) } : {}),
      };
      if (
        result.availableMemoryBytes !== undefined &&
        result.availableMemoryBytes > result.memoryBytes
      )
        return invalid();
      return result;
    }),
  };
  if (new Set(result.gpus.map((gpu) => gpu.id.toLowerCase())).size !== result.gpus.length)
    return invalid();
  for (const key of ['architecture', 'cpuName'] as const)
    if (value[key] !== undefined) result[key] = text(value[key]);
  for (const key of [
    'cpuCores',
    'threads',
    'installedRamBytes',
    'usableRamBytes',
    'availableRamBytes',
  ] as const)
    if (value[key] !== undefined) result[key] = number(value[key]);
  if ((result.cpuCores ?? 0) > 65536 || (result.threads ?? 0) > 65536) return invalid();
  if (value.runtimeBackends !== undefined) {
    if (!Array.isArray(value.runtimeBackends) || value.runtimeBackends.length > 16)
      return invalid();
    result.runtimeBackends = value.runtimeBackends.map((value) => text(value));
  }
  // The network response repeats the small availability list; leave room under its 16KiB frame.
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 8000) return invalid();
  return result;
}
