/** Narrow, data-only renderer contract. No paths, configuration, process IDs or credentials. */
export type RuntimeCommand =
  | { action: 'import' | 'snapshot' | 'stop' }
  | { action: 'remove'; modelId: string }
  | { action: 'load'; modelId: string; draft?: { key: string; revision: number } }
  | { action: 'run-configuration'; configurationId: string; revision: number }
  | { action: 'memory-decision'; id: string; loadAnyway: boolean };
export interface RuntimeModel {
  id: string;
  name: string;
  size: string;
  filename?: string;
  architecture?: string;
  contextLimit?: number;
  blockCount?: number | null;
  embeddedMtp?: boolean;
  quantization?: string;
  parameters?: string;
  unavailable?: boolean;
  /** Last trusted request dispatch, in milliseconds since the Unix epoch. */
  lastUsedAt?: number;
  speculativeHead?: 'eagle3' | 'dflash' | 'dspark' | 'mtp';
}
export interface RuntimeDevice {
  name: string;
  os: string;
  cpuName: string;
  threads: number;
  role: 'Coordinator' | 'Worker';
  gpuMemoryGiB?: number;
  gpuName?: string;
  inventory?: DeviceInventory;
}
/** Observed, data-only hardware facts. An absent reading is unknown, never zero capacity. */
export interface DeviceGpu {
  id: string;
  name: string;
  driverVersion?: string;
  /** Lowercase PCI vendor ID from hardware identity or validated NVIDIA PCI telemetry. */
  pciVendorId?: string;
  /** False when Windows reports a disabled or failed adapter; absent means unknown. */
  enabled?: boolean;
  totalMemoryBytes?: number;
  availableMemoryBytes?: number;
  /** Display telemetry only; not runtime admission or allocatable capacity. */
  utilizationPercent?: number;
  usedMemoryBytes?: number;
  memoryKind?: 'dedicated' | 'unified';
  vendor?: 'apple' | 'intel';
  /** Physical identity from trusted NVIDIA telemetry, never inferred from a display name. */
  executionIdentity?: { vendor: 'nvidia'; uuid: string; pciBus: string } | null;
}
export interface DeviceInventory {
  architecture?: string;
  installedRamBytes?: number;
  usableRamBytes?: number;
  availableRamBytes?: number;
  cpuCores?: number;
  cpuUsagePercent?: number;
  diskReadBytesPerSecond?: number;
  diskWriteBytesPerSecond?: number;
  gpus?: readonly DeviceGpu[];
  runtimeBackends?: readonly string[];
  sampledAt: number;
}
/** Shared display policy; hardware presence is not runtime admission authority. */
export function supportedDeviceGpus(gpus: readonly DeviceGpu[]): readonly DeviceGpu[] {
  return gpus.filter(
    (gpu) =>
      (gpu.pciVendorId === '10de' ||
        gpu.pciVendorId === '1002' ||
        gpu.vendor === 'apple' ||
        gpu.vendor === 'intel') &&
      gpu.enabled !== false,
  );
}
export interface RuntimeView {
  enabled: boolean;
  model: RuntimeModel | null;
  phase: 'stopped' | 'starting' | 'loading' | 'ready' | 'stopping' | 'failed';
  error: string | null;
  /** Observed startup stage, not a tensor byte percentage. */
  loadingStage?: number | undefined;
  device?: RuntimeDevice;
  models?: readonly RuntimeModel[];
  indexing?: string | null;
  restoring?: boolean;
  /** Single pending owner-created memory warning; never a launch capability. */
  memoryWarning?: { id: string } | null;
  /** Published only for a ready, stock-log-verified allocation. */
  activeCluster?: {
    configurationId: string;
    /** Session allocation captured from a draft, separate from named saved configurations. */
    draftKey?: string;
    revision: number;
    runs: readonly { uuid: string; first: number; last: number }[];
  } | null;
}
export interface RuntimeBridge {
  command(value: RuntimeCommand): Promise<RuntimeView>;
}
/** Reject extra fields before any privileged work. Main validates sender identity separately. */
export function decodeRuntimeCommand(value: unknown): RuntimeCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('INVALID_CONTROL');
  const record: Record<string, unknown> = Object.fromEntries(Object.entries(value));
  if (
    record.action === 'remove' &&
    Object.keys(record).length === 2 &&
    typeof record.modelId === 'string' &&
    /^model-[a-f0-9]{64}$/u.test(record.modelId)
  )
    return { action: 'remove', modelId: record.modelId };
  if (
    record.action === 'memory-decision' &&
    Object.keys(record).length === 3 &&
    typeof record.id === 'string' &&
    /^[a-f0-9-]{36}$/u.test(record.id) &&
    typeof record.loadAnyway === 'boolean'
  )
    return { action: 'memory-decision', id: record.id, loadAnyway: record.loadAnyway };
  if (
    record.action === 'run-configuration' &&
    Object.keys(record).length === 3 &&
    typeof record.configurationId === 'string' &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(
      record.configurationId,
    ) &&
    typeof record.revision === 'number' &&
    Number.isSafeInteger(record.revision) &&
    record.revision > 0
  )
    return {
      action: 'run-configuration',
      configurationId: record.configurationId,
      revision: record.revision,
    };
  if (
    record.action === 'load' &&
    Object.keys(record).length === (Object.hasOwn(record, 'draft') ? 3 : 2) &&
    typeof record.modelId === 'string' &&
    /^model-[a-zA-Z0-9-]{1,122}$/u.test(record.modelId)
  ) {
    if (!Object.hasOwn(record, 'draft')) return { action: 'load', modelId: record.modelId };
    const draft = record.draft;
    if (!draft || typeof draft !== 'object' || Array.isArray(draft)) throw Error('INVALID_CONTROL');
    const value = draft as Record<string, unknown>;
    if (
      Object.keys(value).length !== 2 ||
      typeof value.key !== 'string' ||
      (!/^model:[a-f0-9]{64}$/u.test(value.key) &&
        !/^config:[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(
          value.key,
        )) ||
      typeof value.revision !== 'number' ||
      !Number.isSafeInteger(value.revision) ||
      value.revision < 1 ||
      value.revision >= Number.MAX_SAFE_INTEGER
    )
      throw Error('INVALID_CONTROL');
    return {
      action: 'load',
      modelId: record.modelId,
      draft: { key: value.key, revision: value.revision },
    };
  }
  if (
    Object.keys(record).length === 1 &&
    (record.action === 'import' || record.action === 'snapshot' || record.action === 'stop')
  )
    return { action: record.action };
  throw new Error('INVALID_CONTROL');
}
declare global {
  interface Window {
    modelLoomRuntime?: RuntimeBridge;
  }
}
