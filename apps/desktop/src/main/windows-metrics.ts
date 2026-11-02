import path from 'node:path';
import type { DeviceGpu, DeviceInventory } from '../shared/runtime';
import {
  deviceQuery,
  observationList as list,
  observationNumber as number,
  observationRecord as record,
  observationText as text,
} from './device-query';

/** Join Windows counters to DXGI LUIDs, never GPU names or counter enumeration order. */
export function parseWindowsMetrics(input: unknown): Partial<DeviceInventory> {
  const data = record(input),
    memory = list(data.memory),
    engines = list(data.engines);
  const gpus = list(data.adapters).flatMap((adapter): DeviceGpu[] => {
    const name = text(adapter.name),
      luid = text(adapter.luid);
    if (
      !name ||
      !luid ||
      !/^0x[0-9a-f]{8}_0x[0-9a-f]{8}$/iu.test(luid) ||
      number(adapter.vendor) !== 0x1002
    )
      return [];
    const totalMemoryBytes = number(adapter.memory);
    const rows = memory.filter(
      (r) =>
        typeof r.Name === 'string' &&
        r.Name.toLowerCase().startsWith(`luid_${luid.toLowerCase()}_phys_`),
    );
    const used = rows.map((r) => number(r.DedicatedUsage));
    const sum = used.reduce<number>((s, n) => s + (n ?? 0), 0);
    const usedMemoryBytes =
      used.length &&
      used.every((n) => n !== undefined) &&
      totalMemoryBytes !== undefined &&
      sum <= totalMemoryBytes
        ? sum
        : undefined;
    const engineTotals = new Map<string, number>();
    for (const row of engines) {
      if (typeof row.Name !== 'string') continue;
      const match = /_luid_(0x[0-9a-f]{8}_0x[0-9a-f]{8})_(phys_\d+_eng_\d+)_engtype_/iu.exec(
        row.Name,
      );
      const percent = number(row.UtilizationPercentage, 100);
      if (match?.[1]?.toLowerCase() !== luid.toLowerCase() || percent === undefined) continue;
      engineTotals.set(match[2]!, (engineTotals.get(match[2]!) ?? 0) + percent);
    }
    return [
      {
        id: `dxgi-${luid.toLowerCase()}`,
        name,
        pciVendorId: '1002',
        enabled: true,
        memoryKind: 'dedicated',
        ...(totalMemoryBytes !== undefined && totalMemoryBytes > 0 ? { totalMemoryBytes } : {}),
        ...(usedMemoryBytes !== undefined
          ? { usedMemoryBytes, availableMemoryBytes: totalMemoryBytes! - usedMemoryBytes }
          : {}),
        ...(engineTotals.size
          ? { utilizationPercent: Math.min(100, Math.max(...engineTotals.values())) }
          : {}),
      },
    ];
  });
  if (gpus.length > 16 || new Set(gpus.map((g) => g.id)).size !== gpus.length)
    throw Error('INVALID_TELEMETRY');
  const disk = record(data.disk),
    read = number(disk.DiskReadBytesPersec),
    write = number(disk.DiskWriteBytesPersec);
  return {
    ...(data.adapters !== undefined ? { gpus } : {}),
    ...(read !== undefined ? { diskReadBytesPerSecond: read } : {}),
    ...(write !== undefined ? { diskWriteBytesPerSecond: write } : {}),
  };
}

// DXGI supplies the physical adapter's LUID. Its counters are driver-independent and localized names
// are avoided by querying CIM classes. The busiest engine matches Task Manager's utilization policy.
const script = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$result = @{}
try {
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class ModelLoomDisplayAdapters {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct Description {
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string Name;
    public uint Vendor, Device, Subsystem, Revision;
    public UIntPtr DedicatedVideo, DedicatedSystem, SharedSystem;
    public uint Low; public int High; public uint Flags;
  }
  [DllImport("dxgi.dll", ExactSpelling = true)]
  static extern int CreateDXGIFactory1(ref Guid iid, out IntPtr factory);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)]
  delegate int Enumerate(IntPtr self, uint index, out IntPtr adapter);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)]
  delegate int Describe(IntPtr self, out Description description);
  static T Method<T>(IntPtr obj, int slot) where T : class {
    return Marshal.GetDelegateForFunctionPointer(Marshal.ReadIntPtr(Marshal.ReadIntPtr(obj), slot * IntPtr.Size), typeof(T)) as T;
  }
  public static object[] Read() {
    var rows = new List<object>();
    var iid = new Guid("770aae78-f26f-4dba-a829-253c83d1b387");
    IntPtr factory;
    Marshal.ThrowExceptionForHR(CreateDXGIFactory1(ref iid, out factory));
    try {
      for (uint i = 0; i < 64; i++) {
        IntPtr adapter;
        int hr = Method<Enumerate>(factory, 12)(factory, i, out adapter);
        if (hr == unchecked((int)0x887A0002)) break;
        Marshal.ThrowExceptionForHR(hr);
        try {
          Description d;
          Marshal.ThrowExceptionForHR(Method<Describe>(adapter, 10)(adapter, out d));
          if (d.Vendor == 0x1002 && (d.Flags & 2) == 0)
            rows.Add(new { name = d.Name, vendor = d.Vendor, memory = d.DedicatedVideo.ToUInt64(),
              luid = String.Format("0x{0:x8}_0x{1:x8}", unchecked((uint)d.High), d.Low) });
        } finally { Marshal.Release(adapter); }
      }
    } finally { Marshal.Release(factory); }
    return rows.ToArray();
  }
}
'@
$result.adapters = @([ModelLoomDisplayAdapters]::Read())
} catch {}
if ($result.adapters.Count -gt 0) {
  $luidPattern = 'luid_(' + (($result.adapters | ForEach-Object { [regex]::Escape($_.luid) }) -join '|') + ')_phys_'
  try { $result.memory = @(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUAdapterMemory | Where-Object { $_.Name -match $luidPattern } | Select-Object Name,DedicatedUsage) } catch {}
  try { $result.engines = @(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine | Where-Object { $_.Name -match $luidPattern } | Select-Object Name,UtilizationPercentage) } catch {}
}
try { $result.disk = Get-CimInstance Win32_PerfFormattedData_PerfDisk_PhysicalDisk -Filter "Name='_Total'" | Select-Object DiskReadBytesPersec,DiskWriteBytesPersec } catch {}
$result | ConvertTo-Json -Compress -Depth 5
`;

/** AMD/Windows observation; never creates an inference context or requires vendor tooling. */
export async function readWindowsMetrics(run = deviceQuery): Promise<Partial<DeviceInventory>> {
  const root = process.env.SystemRoot;
  if (!root || !path.win32.isAbsolute(root)) return {};
  const output = await run(path.join(root, 'System32/WindowsPowerShell/v1.0/powershell.exe'), [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    script,
  ]);
  return parseWindowsMetrics(
    JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(output).replace(/^\uFEFF/u, ''),
    ) as unknown,
  );
}
