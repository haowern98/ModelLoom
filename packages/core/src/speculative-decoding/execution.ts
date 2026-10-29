import type { ClusterEffectiveLoad } from '../cluster/effective-load.js';
import { clusterDeviceNames, decodeClusterDevice } from '../cluster/device-id.js';

export const nativeMethods = Object.freeze({
  mtp: 'draft-mtp',
  draft: 'draft-simple',
  dflash: 'draft-dflash',
  dspark: 'draft-dspark',
  eagle3: 'draft-eagle3',
});
/** One process-wide visibility/RPC order. Target placement stays first and unchanged. */
export function executionDevices(load: ClusterEffectiveLoad): readonly string[] {
  const ids = [...load.placement.orderedUuids];
  if (
    load.speculation?.enabled &&
    load.speculation.proposer &&
    load.proposerDevice &&
    !['auto', 'cpu'].includes(load.proposerDevice)
  ) {
    decodeClusterDevice(load.proposerDevice);
    if (!ids.some((id) => id.toLowerCase() === load.proposerDevice!.toLowerCase()))
      ids.push(load.proposerDevice);
  }
  return Object.freeze(ids);
}
export function proposerDevice(load: ClusterEffectiveLoad): string {
  return !load.proposerDevice || load.proposerDevice === 'auto'
    ? load.placement.outputUuid
    : load.proposerDevice;
}
/** Paths are supplied only by the sealed library owner, never by renderer settings. */
export function speculativeArguments(
  load: ClusterEffectiveLoad,
  companion?: string,
): readonly string[] {
  const spec = load.speculation;
  if (!spec?.enabled) return [];
  if (
    spec.retrieval &&
    ['ngram-map-k', 'ngram-map-k4v', 'ngram-cache'].includes(spec.retrieval.method)
  )
    throw Error('UNSUPPORTED_SPECULATIVE_RETRIEVAL');
  const types = [
    ...(spec.retrieval ? [spec.retrieval.method] : []),
    ...(spec.proposer ? [nativeMethods[spec.proposer.method]] : []),
  ];
  const args = ['--spec-type', types.join(',')];
  if (spec.proposer) {
    const p = spec.proposer;
    if (p.source.kind === 'asset') {
      if (!companion || companion.includes('\0') || companion.length > 32700)
        throw Error('MODEL_FILE_UNAVAILABLE');
      args.push('--spec-draft-model', companion);
      const device = proposerDevice(load);
      if (
        ['dflash', 'dspark', 'eagle3'].includes(p.method) &&
        device.toLowerCase() !== load.placement.outputUuid.toLowerCase()
      )
        throw Error('UNSUPPORTED_SPECULATIVE_DEVICE');
      const ids = executionDevices(load);
      args.push(
        '--spec-draft-device',
        device === 'cpu'
          ? 'none'
          : clusterDeviceNames(ids)[
              ids.findIndex((id) => id.toLowerCase() === device.toLowerCase())
            ]!,
        '--spec-draft-ngl',
        device === 'cpu' ? '0' : '999',
      );
    } else if (load.proposerDevice && load.proposerDevice !== 'auto') {
      // Embedded NextN uses the target's weights and placement.
      throw Error('UNSUPPORTED_SPECULATIVE_DEVICE');
    }
    if (p.maxDraftTokens !== null) args.push('--spec-draft-n-max', String(p.maxDraftTokens));
    args.push('--spec-draft-type-k', load.cacheK, '--spec-draft-type-v', load.cacheV);
    if (p.method === 'dspark') args.push('--spec-draft-p-min', '0');
  }
  return Object.freeze(args);
}
export function verifySpeculativeStartup(load: ClusterEffectiveLoad, log: string): void {
  if (!load.speculation?.enabled) return;
  if (
    /failed to (?:initialize speculative|load draft|create MTP)|speculative decoding not supported/u.test(
      log,
    ) ||
    !log.includes('speculative decoding context initialized')
  )
    throw Error('SPECULATIVE_INITIALIZATION_FAILED');
}
