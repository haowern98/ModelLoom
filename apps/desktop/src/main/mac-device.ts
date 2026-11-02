import type { DeviceGpu, DeviceInventory } from '../shared/runtime';
import {
  deviceQuery,
  observationList,
  observationNumber as number,
  observationRecord as record,
  observationText as text,
  requireCleanup,
} from './device-query';
import type { DiskCounter } from './device-metrics';

/** IORegistry identity distinguishes equal adapter names. Apple allocations are shared RAM. */
export function parseMacHardware(value: unknown, cpuModel: string): Partial<DeviceInventory> {
  const gpus = observationList(value).flatMap((entry): DeviceGpu[] => {
    const id = number(entry.IORegistryEntryID),
      ioClass = text(entry.IOClass);
    if (id === undefined || !Number.isSafeInteger(id) || !ioClass) return [];
    const apple = /AGX|Apple.*GPU/iu.test(ioClass),
      amd = /AMD|Radeon/iu.test(ioClass),
      intel = /Intel/iu.test(ioClass);
    if (!apple && !amd && !intel) return [];
    const unified = apple || intel;
    const stats = record(entry.PerformanceStatistics);
    const utilizationPercent = number(
      stats['Device Utilization %'] ?? stats['GPU Activity(%)'],
      100,
    );
    const totalMemoryBytes = unified ? undefined : number(stats.vramTotalBytes);
    const used = number(unified ? stats['In use system memory'] : stats.vramUsedBytes);
    const usedMemoryBytes =
      used !== undefined && (totalMemoryBytes === undefined || used <= totalMemoryBytes)
        ? used
        : undefined;
    return [
      {
        id: `ioreg-${id}`,
        name:
          text(entry.model) ??
          (apple
            ? `${cpuModel} GPU`
            : (text(entry.IORegistryEntryName) ?? (intel ? 'Intel GPU' : 'AMD GPU'))),
        ...(apple
          ? { vendor: 'apple' as const }
          : intel
            ? { vendor: 'intel' as const }
            : { pciVendorId: '1002' }),
        memoryKind: unified ? 'unified' : 'dedicated',
        ...(totalMemoryBytes !== undefined && totalMemoryBytes > 0 ? { totalMemoryBytes } : {}),
        ...(usedMemoryBytes !== undefined ? { usedMemoryBytes } : {}),
        ...(utilizationPercent !== undefined ? { utilizationPercent } : {}),
      },
    ];
  });
  if (gpus.length > 16 || new Set(gpus.map((g) => g.id)).size !== gpus.length)
    throw Error('INVALID_TELEMETRY');
  return { gpus };
}

export function parseMacDisks(value: unknown): DiskCounter[] {
  const disks = observationList(value).flatMap((entry) => {
    const id = number(entry.IORegistryEntryID),
      stats = record(entry.Statistics);
    const read = number(stats['Bytes (Read)']),
      write = number(stats['Bytes (Write)']);
    return id !== undefined &&
      read !== undefined &&
      write !== undefined &&
      [id, read, write].every(Number.isSafeInteger)
      ? [{ id: String(id), read, write }]
      : [];
  });
  if (new Set(disks.map((d) => d.id)).size !== disks.length) throw Error('INVALID_TELEMETRY');
  return disks;
}

// Foundation handles plist binary-data values; plutil's JSON mode rejects those common IORegistry properties.
const convertPlist = `ObjC.import('Foundation');
function run() {
  var data = $.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile;
  var plist = $.NSPropertyListSerialization.propertyListWithDataOptionsFormatError(data, 0, null, null);
  if (!plist) throw Error('INVALID_PLIST');
  var rows = ObjC.deepUnwrap(plist);
  return JSON.stringify(rows.map(function(r) {
    function numbers(s) {
      var result = {};
      Object.keys(s || {}).forEach(function(k) { if (typeof s[k] === 'number') result[k] = s[k]; });
      return result;
    }
    return { IORegistryEntryID: r.IORegistryEntryID, IOClass: r.IOClass,
      IORegistryEntryName: r.IORegistryEntryName, model: typeof r.model === 'string' ? r.model : undefined,
      PerformanceStatistics: numbers(r.PerformanceStatistics), Statistics: numbers(r.Statistics) };
  }));
}`;

/** Native plist conversion avoids a new XML parser; both children have fixed commands and bounds. */
export async function readMacHardware(
  cpuModel: string,
  run = deviceQuery,
): Promise<Partial<DeviceInventory> & { disks?: DiskCounter[] }> {
  const read = async (kind: string): Promise<unknown> => {
    const plist = await run('/usr/sbin/ioreg', ['-a', '-l', '-r', '-c', kind, '-d', '1']);
    const json = await run('/usr/bin/osascript', ['-l', 'JavaScript', '-e', convertPlist], plist);
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(json)) as unknown;
  };
  const outcomes = await Promise.allSettled([
    read('IOAccelerator').then((v) => parseMacHardware(v, cpuModel)),
    read('IOBlockStorageDriver').then(parseMacDisks),
  ]);
  requireCleanup(outcomes);
  const [hardware, disks] = outcomes;
  return {
    ...(hardware.status === 'fulfilled' ? hardware.value : {}),
    ...(disks.status === 'fulfilled' ? { disks: disks.value } : {}),
  };
}
