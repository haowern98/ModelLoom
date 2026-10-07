import os from 'node:os';
import type { RuntimeDevice } from '../shared/runtime';

/** Local identity is available without an engine, model, GPU or network connection.
 * A trusted role can be supplied independently of hardware discovery. Unknown GPU
 * capacity is omitted, rather than advertised as zero or as validated runtime support.
 */
export function localDeviceSnapshot(role: RuntimeDevice['role'] = 'Coordinator'): RuntimeDevice {
  const cpus = os.cpus();
  const platform = os.platform();
  return {
    name: os.hostname(),
    os: platform === 'win32' ? 'Windows' : platform === 'darwin' ? 'macOS' : os.type(),
    cpuName: cpus[0]?.model ?? 'CPU details unavailable',
    threads: cpus.length,
    role,
  };
}
