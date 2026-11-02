import path from 'node:path';
import { deviceQuery } from './device-query';

interface NvidiaMetrics {
  uuid: string;
  utilizationPercent?: number;
  usedMemoryBytes?: number;
  totalMemoryBytes?: number;
  availableMemoryBytes?: number;
}

/** Separate display query: it does not change the runtime's eight-field admission parser. */
export function parseNvidiaMetrics(output: Buffer): readonly NvidiaMetrics[] {
  const invalid = (): never => {
    throw Error('INVALID_GPU_TELEMETRY');
  };
  if (output.length > 65536) return invalid();
  const text = new TextDecoder('utf-8', { fatal: true }).decode(output).trim();
  if (!text) return [];
  const rows = text.split(/\r?\n/u);
  if (rows.length > 64) return invalid();
  const ids = new Set<string>();
  const reading = (value: string, maximum: number, scale = 1): number | undefined => {
    if (value === '[N/A]' || value === '[Not Supported]') return;
    if (!/^\d+$/u.test(value)) return invalid();
    const number = Number(value) * scale;
    if (!Number.isSafeInteger(number) || number < 0 || number > maximum) return invalid();
    return number;
  };
  return rows.map((row) => {
    const fields = row.split(',').map((field) => field.trim());
    const [uuid, percent, used, total, free] = fields;
    if (
      fields.length !== 5 ||
      !uuid ||
      percent === undefined ||
      used === undefined ||
      total === undefined ||
      free === undefined ||
      !/^GPU-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(uuid) ||
      ids.has(uuid.toLowerCase())
    )
      return invalid();
    ids.add(uuid.toLowerCase());
    const utilizationPercent = reading(percent, 100);
    const usedMemoryBytes = reading(used, Number.MAX_SAFE_INTEGER, 2 ** 20);
    const totalMemoryBytes = reading(total, Number.MAX_SAFE_INTEGER, 2 ** 20);
    const availableMemoryBytes = reading(free, Number.MAX_SAFE_INTEGER, 2 ** 20);
    if (
      totalMemoryBytes === 0 ||
      (usedMemoryBytes !== undefined &&
        totalMemoryBytes !== undefined &&
        usedMemoryBytes > totalMemoryBytes) ||
      (availableMemoryBytes !== undefined &&
        totalMemoryBytes !== undefined &&
        availableMemoryBytes > totalMemoryBytes)
    )
      return invalid();
    return {
      uuid,
      ...(utilizationPercent !== undefined ? { utilizationPercent } : {}),
      ...(usedMemoryBytes !== undefined ? { usedMemoryBytes } : {}),
      ...(totalMemoryBytes !== undefined ? { totalMemoryBytes } : {}),
      ...(availableMemoryBytes !== undefined ? { availableMemoryBytes } : {}),
    };
  });
}

/** Fixed, bounded, read-only query. NVIDIA UUIDs remain the sole matching key. */
export async function readNvidiaMetrics(run = deviceQuery): Promise<readonly NvidiaMetrics[]> {
  const root = process.env.SystemRoot;
  if (!root || !path.win32.isAbsolute(root)) return [];
  return parseNvidiaMetrics(
    await run(path.join(root, 'System32/nvidia-smi.exe'), [
      '--query-gpu=uuid,utilization.gpu,memory.used,memory.total,memory.free',
      '--format=csv,noheader,nounits',
    ]),
  );
}
