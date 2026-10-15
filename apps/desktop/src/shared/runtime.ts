/** Narrow, data-only renderer contract. No paths, configuration, process IDs or credentials. */
export type RuntimeCommand =
  { action: 'import' | 'snapshot' | 'stop' } | { action: 'load'; modelId: string };
export interface RuntimeModel {
  id: string;
  name: string;
  size: string;
  filename?: string;
  architecture?: string;
  contextLimit?: number;
  quantization?: string;
  parameters?: string;
  unavailable?: boolean;
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
}
export interface DeviceInventory {
  architecture?: string;
  installedRamBytes?: number;
  usableRamBytes?: number;
  availableRamBytes?: number;
  cpuCores?: number;
  gpus?: readonly DeviceGpu[];
  runtimeBackends?: readonly string[];
  sampledAt: number;
}
/** Shared display policy; hardware presence is not runtime admission authority. */
export function supportedDeviceGpus(gpus: readonly DeviceGpu[]): readonly DeviceGpu[] {
  return gpus.filter(
    (gpu) => (gpu.pciVendorId === '10de' || gpu.pciVendorId === '1002') && gpu.enabled !== false,
  );
}
export interface RuntimeView {
  enabled: boolean;
  model: RuntimeModel | null;
  phase: 'stopped' | 'starting' | 'loading' | 'ready' | 'stopping' | 'failed';
  error: string | null;
  device?: RuntimeDevice;
  models?: readonly RuntimeModel[];
  indexing?: string | null;
  restoring?: boolean;
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
    record.action === 'load' &&
    Object.keys(record).length === 2 &&
    typeof record.modelId === 'string' &&
    /^model-[a-zA-Z0-9-]{1,122}$/u.test(record.modelId)
  )
    return { action: 'load', modelId: record.modelId };
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
