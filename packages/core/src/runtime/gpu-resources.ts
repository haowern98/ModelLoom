import { checkResources } from './preflight.js';
import type { PlannerReport, Preflight, RuntimeConfiguration } from './preflight.js';

/** A fresh physical-device observation, not an allocation guarantee or a CUDA context. */
export interface GpuResource {
  readonly uuid: string;
  readonly name?: string | null;
  readonly bus: string;
  readonly driver: string;
  readonly total: number | null;
  readonly free: number | null;
  readonly mig: '[N/A]' | 'Disabled' | 'Enabled';
  readonly driverModel: 'WDDM' | 'TCC' | 'MCDM';
}
export interface ResourceSnapshot {
  readonly ram: number | null;
  /** Null means discovery failed; an empty array means a successful query found no GPUs. */
  readonly gpus: readonly GpuResource[] | null;
}
const uuidPattern = /^GPU-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu;
const versionPattern = /^\d{1,3}(?:\.\d{1,3}){1,3}$/u;
// Leave the same physical-RAM reserve used by the bounded 3060 overflow diagnostic.
const sharedMemoryReserve = 1536 * 1048576;

/** Decodes only the eight fixed NVIDIA CSV properties, converting integer MiB to bytes.
 * The bounded display name remains attached to its physical UUID; it is not admission authority.
 */
export function parseGpuQuery(output: Buffer): readonly GpuResource[] {
  const invalid = () => {
    throw new Error('INVALID_GPU_QUERY');
  };
  if (output.length > 65536) return invalid();
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(output).trim();
  } catch {
    return invalid();
  }
  if (!text) return Object.freeze([]);
  const rows = text.split(/\r?\n/u);
  if (rows.length > 64) return invalid();
  const ids = new Set<string>(),
    buses = new Set<string>();
  const memory = (value: string): number | null => {
    if (value === '[N/A]') return null;
    if (!/^\d+$/u.test(value)) return invalid();
    const bytes = Number(value) * 1048576;
    if (!Number.isSafeInteger(bytes)) return invalid();
    return bytes;
  };
  return Object.freeze(
    rows.map((row): GpuResource => {
      const fields = row.split(',').map((field) => field.trim());
      const [uuid, bus, driver, totalMiB, freeMiB, mig, driverModel, name] = fields;
      if (
        fields.length !== 8 ||
        !uuid ||
        !bus ||
        !driver ||
        !name ||
        name.length > 256 ||
        Array.from(name).some(
          (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
        ) ||
        totalMiB === undefined ||
        freeMiB === undefined ||
        !uuidPattern.test(uuid) ||
        !/^[a-f0-9]{8}:[a-f0-9]{2}:[a-f0-9]{2}\.[0-7]$/iu.test(bus) ||
        !versionPattern.test(driver) ||
        ids.has(uuid.toLowerCase()) ||
        buses.has(bus.toLowerCase()) ||
        (mig !== '[N/A]' && mig !== 'Disabled' && mig !== 'Enabled') ||
        (driverModel !== 'WDDM' && driverModel !== 'TCC' && driverModel !== 'MCDM')
      )
        return invalid();
      ids.add(uuid.toLowerCase());
      buses.add(bus.toLowerCase());
      const total = memory(totalMiB),
        free = memory(freeMiB);
      if (total !== null && free !== null && free > total) return invalid();
      return Object.freeze({
        uuid,
        name: name === '[N/A]' ? null : name,
        bus,
        driver,
        total,
        free,
        mig,
        driverModel,
      });
    }),
  );
}

function meetsDriver(actual: string, minimum: string): boolean {
  const a = actual.split('.').map(Number),
    b = minimum.split('.').map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) > (b[index] ?? 0);
  }
  return true;
}

/** Pure CUDA admission check. Requires independently validated placement and a signed inventory's NVIDIA driver minimum.
 * Confirmed single-GPU WDDM fallback reserves the full GPU budget in RAM as well,
 * since the driver controls residency. Unknowns fail closed. This does not authorize launching
 * an engine, establish the launch's device mapping, or reserve memory against other applications.
 */
export function checkCudaResources(
  configuration: RuntimeConfiguration,
  artifact: string,
  report: PlannerReport | undefined,
  snapshot: ResourceSnapshot,
  minimumDriver: string,
  sharedMemoryConfirmed = false,
): Preflight {
  const base = checkResources(configuration, artifact, 'cuda', report, {
    ram: snapshot.ram ?? NaN,
    vram: Number.MAX_SAFE_INTEGER,
  });
  const result = (code: Preflight['code']): Preflight => Object.freeze({ ...base, code });
  if (base.code !== 'ADMITTED' && base.code !== 'INSUFFICIENT_RESOURCES') return base;
  const placement = report?.deviceVram;
  if (
    !snapshot.gpus ||
    !versionPattern.test(minimumDriver) ||
    !placement ||
    (configuration.gpuDevice !== undefined &&
      (placement.length !== 1 ||
        placement[0]?.uuid.toLowerCase() !== configuration.gpuDevice.toLowerCase())) ||
    placement.length === 0 ||
    placement.length > 64
  )
    return result('NEEDS_RESOURCE_EVIDENCE');
  const ids = new Set<string>();
  let total = 0,
    shortage = base.code === 'INSUFFICIENT_RESOURCES',
    incompatible = false,
    wddm = true;
  for (const device of placement) {
    if (
      !uuidPattern.test(device.uuid) ||
      ids.has(device.uuid.toLowerCase()) ||
      !Number.isSafeInteger(device.bytes) ||
      device.bytes <= 0
    )
      return result('NEEDS_RESOURCE_EVIDENCE');
    ids.add(device.uuid.toLowerCase());
    total += device.bytes;
    const gpu = snapshot.gpus.find(
      (entry) => entry.uuid.toLowerCase() === device.uuid.toLowerCase(),
    );
    if (
      !gpu ||
      !versionPattern.test(gpu.driver) ||
      gpu.mig === 'Enabled' ||
      (gpu.mig !== '[N/A]' && gpu.mig !== 'Disabled') ||
      !Number.isSafeInteger(gpu.free) ||
      !Number.isSafeInteger(gpu.total) ||
      gpu.free === null ||
      gpu.total === null ||
      gpu.free < 0 ||
      gpu.free > gpu.total
    )
      return result('NEEDS_RESOURCE_EVIDENCE');
    incompatible ||= !meetsDriver(gpu.driver, minimumDriver);
    wddm &&= gpu.driverModel === 'WDDM' && meetsDriver(gpu.driver, '546.01');
    shortage ||= gpu.free < device.bytes;
  }
  if (!Number.isSafeInteger(total) || total !== base.vram) return result('NEEDS_RESOURCE_EVIDENCE');
  if (
    !incompatible &&
    shortage &&
    base.code === 'ADMITTED' &&
    configuration.gpuDevice &&
    placement.length === 1 &&
    wddm
  ) {
    // Reserve all GPU backing, not just the apparent shortage: Windows can move
    // other allocations too. This is an estimate, never a memory reservation.
    const ram = base.ram! + total + sharedMemoryReserve;
    if (!Number.isSafeInteger(ram)) return result('NEEDS_RESOURCE_EVIDENCE');
    return Object.freeze({
      ...base,
      ram,
      code:
        snapshot.ram! < ram
          ? 'INSUFFICIENT_RESOURCES'
          : sharedMemoryConfirmed
            ? 'ADMITTED'
            : 'SHARED_GPU_MEMORY_CONFIRMATION',
    });
  }
  return result(
    incompatible ? 'INCOMPATIBLE_DRIVER' : shortage ? 'INSUFFICIENT_RESOURCES' : 'ADMITTED',
  );
}
