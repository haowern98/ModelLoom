import type { ClusterEffectiveLoad } from './effective-load.js';
import type { ResourceSnapshot } from '../runtime/gpu-resources.js';
export interface ClusterResourceReport {
  readonly fingerprint: string;
  readonly artifact: string;
  readonly modelSha256: string;
  readonly hostBytes: number;
  readonly devices: readonly { readonly uuid: string; readonly bytes: number }[];
  readonly profileId: string;
  readonly uncertainty: null;
}
// No new split is approved by the existing scalar reports or the 3060 spill probe.
// Populate only from independently reviewed native placement/resource evidence.
const approvedReports: readonly ClusterResourceReport[] = Object.freeze([]);
export function approvedClusterReport(
  load: ClusterEffectiveLoad,
): ClusterResourceReport | undefined {
  return approvedReports.find(
    (r) =>
      r.fingerprint === load.fingerprint &&
      r.artifact === load.artifact &&
      r.modelSha256 === load.modelSha256,
  );
}
/** Report identity comes from the trusted catalog, never a renderer/estimator object. */
export function checkClusterResources(
  load: ClusterEffectiveLoad,
  report: ClusterResourceReport | undefined,
  snapshot: ResourceSnapshot,
  minimumDriver: string,
): {
  readonly code:
    'ADMITTED' | 'NEEDS_RESOURCE_EVIDENCE' | 'INSUFFICIENT_RESOURCES' | 'INCOMPATIBLE_DRIVER';
} {
  if (
    !report ||
    !approvedReports.includes(report) ||
    report.fingerprint !== load.fingerprint ||
    report.uncertainty !== null ||
    !snapshot.gpus ||
    snapshot.ram === null ||
    !Number.isSafeInteger(report.hostBytes) ||
    report.hostBytes < 1 ||
    !/^[0-9]{1,3}(\.[0-9]{1,3}){1,3}$/u.test(minimumDriver)
  )
    return { code: 'NEEDS_RESOURCE_EVIDENCE' };
  if (
    report.devices.length !== load.placement.orderedUuids.length ||
    snapshot.ram < report.hostBytes
  )
    return { code: 'INSUFFICIENT_RESOURCES' };
  for (const uuid of load.placement.orderedUuids) {
    const budgets = report.devices.filter((d) => d.uuid.toLowerCase() === uuid.toLowerCase()),
      gpus = snapshot.gpus.filter((g) => g.uuid.toLowerCase() === uuid.toLowerCase());
    if (
      budgets.length !== 1 ||
      gpus.length !== 1 ||
      !Number.isSafeInteger(budgets[0]!.bytes) ||
      budgets[0]!.bytes < 1 ||
      gpus[0]!.free === null
    )
      return { code: 'NEEDS_RESOURCE_EVIDENCE' };
    const a = gpus[0]!.driver.split('.').map(Number),
      b = minimumDriver.split('.').map(Number);
    if (!/^[0-9]{1,3}(\.[0-9]{1,3}){1,3}$/u.test(gpus[0]!.driver))
      return { code: 'NEEDS_RESOURCE_EVIDENCE' };
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if ((a[i] ?? 0) < (b[i] ?? 0)) return { code: 'INCOMPATIBLE_DRIVER' };
      if ((a[i] ?? 0) > (b[i] ?? 0)) break;
    }
    if (gpus[0]!.mig === 'Enabled' || gpus[0]!.free < budgets[0]!.bytes)
      return { code: 'INSUFFICIENT_RESOURCES' };
  }
  return { code: 'ADMITTED' };
}
