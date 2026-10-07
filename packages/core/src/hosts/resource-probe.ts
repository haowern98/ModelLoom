import { spawn } from 'node:child_process';
import path from 'node:path';
import { ownershipBinding } from './windows-ownership.js';
import { collectDiagnostic } from './diagnostic-process.js';
import { parseGpuQuery } from '../runtime/gpu-resources.js';
import type { ResourceSnapshot } from '../runtime/gpu-resources.js';

export interface ResourceDiscovery extends ResourceSnapshot {
  readonly gpuQuery: string;
}

/** Windows x64 read-only snapshot. No model, CUDA context, driver settings, miner or engine is touched.
 * Uses only the OS-resolved NVIDIA tool and fixed query arguments, with no shell or inherited PATH.
 * Every call samples afresh; missing/failed discovery is unknown, never cached capacity or zero VRAM.
 * Cancellation and failed query cleanup propagate instead of continuing toward admission.
 */
export async function discoverResources(signal?: AbortSignal): Promise<ResourceDiscovery> {
  if (signal?.aborted) throw new Error('QUERY_CANCELLED');
  const native = ownershipBinding();
  let ram: number | null;
  try {
    ram = native.availableMemory();
  } catch {
    ram = null;
  }
  if (!Number.isSafeInteger(ram) || (ram !== null && ram < 0)) ram = null;
  const system = native.systemDirectory();
  const query = spawn(
    path.join(system, 'nvidia-smi.exe'),
    [
      '--query-gpu=uuid,pci.bus_id,driver_version,memory.total,memory.free,mig.mode.current,driver_model.current,name',
      '--format=csv,noheader,nounits',
    ],
    {
      windowsHide: true,
      cwd: system,
      stdio: 'pipe',
      // This NVIDIA driver needs ProgramFiles to initialize NVML; never inherit a caller override.
      env: {
        SystemRoot: path.dirname(system),
        PATH: system,
        ProgramFiles: native.programDirectory(),
      },
    },
  );
  try {
    const gpus = parseGpuQuery(await collectDiagnostic(query, signal));
    if (signal?.aborted) throw new Error('QUERY_CANCELLED');
    // RAM is resampled after query completion, close to the admission check.
    try {
      ram = native.availableMemory();
    } catch {
      ram = null;
    }
    if (!Number.isSafeInteger(ram) || (ram !== null && ram < 0)) ram = null;
    return Object.freeze({ ram, gpus, gpuQuery: 'OK' });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'QUERY_FAILED';
    if (code === 'QUERY_CANCELLED' || code === 'QUERY_CLEANUP_FAILED') throw error;
    return Object.freeze({ ram, gpus: null, gpuQuery: code });
  }
}
