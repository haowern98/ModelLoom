import type { ClusterEffectiveLoad } from './effective-load.js';
/** Proposed owner-only receipt consumer. Stock startup logs cannot satisfy this contract. */
export function validatePlacementReceipt(
  bytes: Uint8Array,
  load: ClusterEffectiveLoad,
  capturedPid: number,
): true {
  const fail = (): never => {
    throw Error('PLACEMENT_MISMATCH');
  };
  const object = (v: unknown, keys: readonly string[]): Record<string, unknown> => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return fail();
    const r = v as Record<string, unknown>;
    if (Object.keys(r).length !== keys.length || keys.some((k) => !Object.hasOwn(r, k)))
      return fail();
    return r;
  };
  try {
    if (bytes.byteLength > 1048576 || !Number.isSafeInteger(capturedPid) || capturedPid < 1)
      return fail();
    const r = object(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown,
      [
        'version',
        'pid',
        'artifact',
        'modelSha256',
        'fingerprint',
        'orderedUuids',
        'inputDevice',
        'fallback',
        'blocks',
        'output',
      ],
    );
    if (
      r.version !== 1 ||
      r.pid !== capturedPid ||
      r.artifact !== load.artifact ||
      r.modelSha256 !== load.modelSha256 ||
      r.fingerprint !== load.fingerprint ||
      r.inputDevice !== 'cpu' ||
      r.fallback !== false ||
      JSON.stringify(r.orderedUuids) !== JSON.stringify(load.placement.orderedUuids) ||
      !Array.isArray(r.blocks) ||
      r.blocks.length !== load.blockCount
    )
      return fail();
    const tensorDevices = (value: unknown, uuid: string) => {
      if (
        !Array.isArray(value) ||
        !value.length ||
        value.length > 65536 ||
        value.some((v) => v !== uuid)
      )
        return fail();
    };
    const weights = load.placement.tensorSplit;
    const threshold =
      weights.length === 2 ? Math.fround(weights[0]! / Math.fround(weights[0]! + weights[1]!)) : 1;
    for (let i = 0; i < r.blocks.length; i++) {
      const b = object(r.blocks[i], [
        'index',
        'deviceUuid',
        'tensorDevices',
        'cacheDeviceUuid',
        'executedDeviceUuid',
      ]);
      const uuid =
        load.placement.orderedUuids[Math.fround(i / (load.blockCount + 1)) < threshold ? 0 : 1]!;
      if (
        b.index !== i ||
        b.deviceUuid !== uuid ||
        b.cacheDeviceUuid !== uuid ||
        b.executedDeviceUuid !== uuid
      )
        return fail();
      tensorDevices(b.tensorDevices, uuid);
    }
    const out = object(r.output, ['deviceUuid', 'tensorDevices', 'executedDeviceUuid']);
    if (
      out.deviceUuid !== load.placement.outputUuid ||
      out.executedDeviceUuid !== load.placement.outputUuid
    )
      return fail();
    tensorDevices(out.tensorDevices, load.placement.outputUuid);
    return true;
  } catch {
    return fail();
  }
}
