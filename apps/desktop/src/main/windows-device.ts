import { spawn } from 'node:child_process';
import path from 'node:path';
import type { DeviceGpu, DeviceInventory } from '../shared/runtime';
import { collectDiagnostic } from '../../../../packages/core/src/hosts/diagnostic-process';
import { parseGpuQuery } from '../../../../packages/core/src/runtime/gpu-resources';

type WindowsHardware = Partial<DeviceInventory> & { os?: string };
const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
const text = (value: unknown): string | undefined =>
  typeof value === 'string' &&
  value.trim().length > 0 &&
  value.length <= 256 &&
  !Array.from(value).some(
    (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
  )
    ? value.trim()
    : undefined;
const integer = (value: unknown): number | undefined => {
  if (typeof value !== 'number' && !(typeof value === 'string' && /^\d+$/u.test(value))) return;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : undefined;
};
function list(value: unknown): unknown[] | undefined {
  if (value == null) return;
  if (!Array.isArray(value) || value.length > 64) throw new Error('INVALID_HARDWARE');
  return value as unknown[];
}
/** Decodes only queried OS facts. WMI AdapterRAM is uint32 and is deliberately not trusted. */
export function parseWindowsHardware(value: unknown): WindowsHardware {
  const data = record(value);
  if (!data) throw new Error('INVALID_HARDWARE');
  const result: WindowsHardware = {};
  const os = record(data.os),
    release = record(data.release);
  const caption = text(os?.Caption),
    version = text(os?.Version);
  const build = text(os?.BuildNumber),
    display = text(release?.DisplayVersion);
  const revision = integer(release?.UBR);
  if (caption)
    result.os = [
      caption,
      display,
      build ? `Build ${build}${revision !== undefined ? `.${revision}` : ''}` : version,
    ]
      .filter(Boolean)
      .join(' · ');
  const memory = list(data.memory)?.map((m) => integer(record(m)?.Capacity));
  if (memory?.length && memory.every((n) => n !== undefined && n > 0)) {
    const total = memory.reduce<number>((sum, n) => sum + (n ?? 0), 0);
    if (Number.isSafeInteger(total)) result.installedRamBytes = total;
  }
  const cores = list(data.processors)?.map((c) => integer(record(c)?.NumberOfCores));
  if (cores?.length && cores.every((n) => n !== undefined && n > 0))
    result.cpuCores = cores.reduce<number>((s, n) => s + (n ?? 0), 0);
  const gpus = list(data.gpus);
  if (gpus) {
    const decoded = gpus.flatMap((entry, index) => {
      const gpu = record(entry),
        name = text(gpu?.Name);
      if (!name) return [];
      const driverVersion = text(gpu?.DriverVersion),
        totalMemoryBytes = integer(gpu?.dedicatedBytes);
      const pciVendorId = /^PCI\\VEN_([a-f0-9]{4})&DEV_[a-f0-9]{4}(?:[&\\]|$)/iu
        .exec(text(gpu?.PNPDeviceID) ?? '')?.[1]
        ?.toLowerCase();
      const status = integer(gpu?.ConfigManagerErrorCode);
      return [
        {
          id: `gpu-${index}`,
          name,
          ...(pciVendorId ? { pciVendorId } : {}),
          ...(status !== undefined ? { enabled: status === 0 } : {}),
          ...(driverVersion ? { driverVersion } : {}),
          ...(totalMemoryBytes !== undefined ? { totalMemoryBytes } : {}),
        },
      ];
    });
    if (gpus.length === 0 || decoded.length > 0) result.gpus = decoded;
  }
  return result;
}
interface GpuReading {
  uuid?: string;
  bus?: string;
  name?: string | null;
  total: number | null;
  free: number | null;
  driver: string;
}
/** Match by unique reported name only; identical adapters must never borrow each other's free memory. */
export function mergeGpuReadings(
  gpus: readonly DeviceGpu[] | undefined,
  readings: readonly GpuReading[] | undefined,
): readonly DeviceGpu[] | undefined {
  if (!readings) return gpus;
  // Physical telemetry rows stand on their own. Never attach execution identity by name.
  if (
    readings.length &&
    readings.every(
      (r) =>
        /^GPU-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(r.uuid ?? '') &&
        /^[a-f0-9]{8}:[a-f0-9]{2}:[a-f0-9]{2}\.[0-7]$/iu.test(r.bus ?? ''),
    )
  ) {
    return [
      ...(gpus ?? []).filter((g) => g.pciVendorId !== '10de'),
      ...readings.map((g): DeviceGpu => ({
        id: g.uuid!,
        name: g.name ?? 'NVIDIA GPU',
        pciVendorId: '10de',
        enabled: true,
        driverVersion: g.driver,
        executionIdentity: { vendor: 'nvidia', uuid: g.uuid!, pciBus: g.bus! },
        ...(g.total !== null ? { totalMemoryBytes: g.total } : {}),
        ...(g.free !== null ? { availableMemoryBytes: g.free } : {}),
      })),
    ];
  }
  if (!gpus)
    return readings.flatMap((g, index) =>
      g.name
        ? [
            {
              id: `gpu-${index}`,
              name: g.name,
              pciVendorId: '10de',
              driverVersion: g.driver,
              ...(g.total !== null ? { totalMemoryBytes: g.total } : {}),
              ...(g.free !== null ? { availableMemoryBytes: g.free } : {}),
            },
          ]
        : [],
    );
  return gpus.map((gpu) => {
    const matches = readings.filter((r) => r.name === gpu.name);
    if (matches.length !== 1 || gpus.filter((g) => g.name === gpu.name).length !== 1) return gpu;
    const reading = matches[0]!;
    return {
      ...gpu,
      ...(reading.total !== null ? { totalMemoryBytes: reading.total } : {}),
      ...(reading.free !== null ? { availableMemoryBytes: reading.free } : {}),
    };
  });
}

// Fixed queries only. Native readings remain independent so one unavailable class cannot hide others.
const script = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$result = @{}
try { $result.os = Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version,BuildNumber } catch {}
try { $result.release = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion' | Select-Object DisplayVersion,UBR } catch {}
try { $result.processors = @(Get-CimInstance Win32_Processor | Select-Object NumberOfCores) } catch {}
try { $result.memory = @(Get-CimInstance Win32_PhysicalMemory | Select-Object Capacity) } catch {}
try {
  $result.gpus = @(Get-CimInstance Win32_VideoController | ForEach-Object {
    $bytes = $null
    try {
      $driver = (Get-ItemProperty -LiteralPath ('HKLM:\SYSTEM\CurrentControlSet\Enum\' + $_.PNPDeviceID)).Driver
      if ($driver -match '^\{[a-fA-F0-9-]{36}\}\\\d{4}$') {
        $bytes = (Get-ItemProperty -LiteralPath ('HKLM:\SYSTEM\CurrentControlSet\Control\Class\' + $driver)).'HardwareInformation.qwMemorySize'
      }
    } catch {}
    @{ Name = $_.Name; PNPDeviceID = $_.PNPDeviceID; ConfigManagerErrorCode = $_.ConfigManagerErrorCode; DriverVersion = $_.DriverVersion; dedicatedBytes = $bytes }
  })
} catch {}
$result | ConvertTo-Json -Compress -Depth 4
`;
async function query(
  executable: string,
  args: string[],
  system: string,
  timeout: number,
): Promise<Buffer> {
  return collectDiagnostic(
    spawn(executable, args, {
      windowsHide: true,
      shell: false,
      cwd: system,
      stdio: 'pipe',
      env: {
        SystemRoot: path.dirname(system),
        PATH: system,
        ...(process.env.ProgramFiles ? { ProgramFiles: process.env.ProgramFiles } : {}),
      },
    }),
    undefined,
    timeout,
  );
}
/** Built-in Windows provider plus optional NVIDIA telemetry. No model launch, driver change or elevation. */
export async function readWindowsHardware(run: typeof query = query): Promise<WindowsHardware> {
  const root = process.env.SystemRoot;
  if (!root || !path.win32.isAbsolute(root)) return {};
  const system = path.join(root, 'System32');
  const [hardware, gpu] = await Promise.allSettled([
    run(
      path.join(system, 'WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
      system,
      8000,
    ).then((b) =>
      parseWindowsHardware(
        JSON.parse(
          new TextDecoder('utf-8', { fatal: true }).decode(b).replace(/^\uFEFF/u, ''),
        ) as unknown,
      ),
    ),
    run(
      path.join(system, 'nvidia-smi.exe'),
      [
        '--query-gpu=uuid,pci.bus_id,driver_version,memory.total,memory.free,mig.mode.current,driver_model.current,name',
        '--format=csv,noheader,nounits',
      ],
      system,
      2000,
    ).then(parseGpuQuery),
  ]);
  for (const outcome of [hardware, gpu]) {
    if (
      outcome.status === 'rejected' &&
      outcome.reason instanceof Error &&
      outcome.reason.message === 'QUERY_CLEANUP_FAILED'
    )
      throw new Error('QUERY_CLEANUP_FAILED');
  }
  const result = hardware.status === 'fulfilled' ? hardware.value : {};
  const gpus = mergeGpuReadings(result.gpus, gpu.status === 'fulfilled' ? gpu.value : undefined);
  return { ...result, ...(gpus !== undefined ? { gpus } : {}) };
}
