/** Narrow, data-only renderer contract. No paths, configuration, process IDs or credentials. */
export type RuntimeCommand =
  { action: 'import' | 'snapshot' | 'stop' } | { action: 'load'; modelId: string };
export interface RuntimeModel {
  id: string;
  name: string;
  size: string;
}
export interface RuntimeDevice {
  name: string;
  os: string;
  cpuName: string;
  threads: number;
  role: 'Coordinator' | 'Worker';
  gpuMemoryGiB?: number;
  gpuName?: string;
}
export interface RuntimeView {
  enabled: boolean;
  model: RuntimeModel | null;
  phase: 'stopped' | 'starting' | 'loading' | 'ready' | 'stopping' | 'failed';
  error: string | null;
  device?: RuntimeDevice;
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
