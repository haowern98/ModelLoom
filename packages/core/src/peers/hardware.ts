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
  cpuUsagePercent?: number;
  diskReadBytesPerSecond?: number;
  diskWriteBytesPerSecond?: number;
  runtimeBackends?: readonly string[];
  sampledAt: number;
  gpus: readonly {
    id: string;
    name: string;
    memoryBytes: number;
    availableMemoryBytes?: number;
    driverVersion?: string;
    utilizationPercent?: number;
    usedMemoryBytes?: number;
    memoryKind?: 'dedicated' | 'unified';
    vendor?: 'apple' | 'intel';
    pciVendorId?: string;
  }[];
}
function invalid(): never {
  throw Error('INVALID_HARDWARE');
}

/** Metrics are opt-in on inventory-watch, so older closed-schema readers retain their wire format. */
export function peerHardwareView(hardware: PeerHardware, metrics: boolean): PeerHardware {
  if (metrics) return hardware;
  const result = {
    ...hardware,
    gpus: hardware.gpus.map((gpu) => {
      const value = { ...gpu };
      delete value.utilizationPercent;
      delete value.usedMemoryBytes;
      delete value.memoryKind;
      delete value.vendor;
      delete value.pciVendorId;
      return value;
    }),
  };
  delete result.cpuUsagePercent;
  delete result.diskReadBytesPerSecond;
  delete result.diskWriteBytesPerSecond;
  return result;
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
function reading(value: unknown, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > maximum)
    return invalid();
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
    'cpuUsagePercent',
    'diskReadBytesPerSecond',
    'diskWriteBytesPerSecond',
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
        'utilizationPercent',
        'usedMemoryBytes',
        'memoryKind',
        'vendor',
        'pciVendorId',
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
      if (gpu.utilizationPercent !== undefined)
        result.utilizationPercent = reading(gpu.utilizationPercent, 100);
      if (gpu.usedMemoryBytes !== undefined) result.usedMemoryBytes = number(gpu.usedMemoryBytes);
      if (gpu.memoryKind !== undefined) {
        if (gpu.memoryKind !== 'dedicated' && gpu.memoryKind !== 'unified') return invalid();
        result.memoryKind = gpu.memoryKind;
      }
      if (gpu.vendor !== undefined) {
        if (gpu.vendor !== 'apple' && gpu.vendor !== 'intel') return invalid();
        result.vendor = gpu.vendor;
      }
      if (gpu.pciVendorId !== undefined) {
        if (gpu.pciVendorId !== '1002' && gpu.pciVendorId !== '10de') return invalid();
        result.pciVendorId = gpu.pciVendorId;
      }
      if (
        result.memoryKind !== 'unified' &&
        result.usedMemoryBytes !== undefined &&
        result.usedMemoryBytes > result.memoryBytes
      )
        return invalid();
      if (
        result.availableMemoryBytes !== undefined &&
        result.availableMemoryBytes > result.memoryBytes
      )
        return invalid();
      return result;
    }),
  };
  if (value.cpuUsagePercent !== undefined)
    result.cpuUsagePercent = reading(value.cpuUsagePercent, 100);
  for (const key of ['diskReadBytesPerSecond', 'diskWriteBytesPerSecond'] as const)
    if (value[key] !== undefined) result[key] = reading(value[key]);
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
