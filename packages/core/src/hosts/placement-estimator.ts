import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { InstalledPackage } from '../runtime-package/install.js';
import { requireInstalledLive, revalidateInstalled } from '../runtime-package/install.js';
import { inspectGGUF } from '../runtime/gguf.js';
import type { GGUFInfo } from '../runtime/gguf.js';
import { ownershipBinding, confirmExit } from './windows-ownership.js';
import { clusterLoadArguments } from '../cluster/effective-load.js';
import type { ClusterEffectiveLoad } from '../cluster/effective-load.js';
import { parseClusterEstimate } from '../cluster/estimate.js';
import type { CandidateEstimate } from '../cluster/estimate.js';
// Failed cleanup must retain file identities instead of reopening replaceable binaries.
const unsettledLocks = new Set<object>();
const inspections = new WeakMap<object, { readonly file: string; readonly info: GGUFInfo }>();
/** Reuse one inspection only while its native file seal remains held by this owner. */
export async function withPlacementModel<T>(
  file: string,
  callback: (info: GGUFInfo, inspection: object) => Promise<T>,
): Promise<T> {
  const resolved = path.resolve(file),
    native = ownershipBinding(),
    seal = native.sealFiles([resolved]),
    inspection = Object.freeze({});
  try {
    const info = await inspectGGUF(resolved);
    inspections.set(inspection, { file: resolved, info });
    return await callback(info, inspection);
  } finally {
    inspections.delete(inspection);
    native.releaseFiles(seal);
  }
}
async function settleEstimator(
  native: ReturnType<typeof ownershipBinding>,
  files: { release(): void },
  modelLock: object | undefined,
  root: object | undefined,
  child: object | undefined,
): Promise<void> {
  let cleaned = !child;
  try {
    if (root) native.closeDeployment(root);
    if (child) {
      await confirmExit(() => {
        const s = native.observe(child);
        return s.activeProcesses === 0 && s.exitCode !== -1;
      });
      cleaned = true;
      native.release(child);
    }
  } catch {
    throw Error('CLEANUP_FAILED');
  } finally {
    if (cleaned) {
      if (modelLock) native.releaseFiles(modelLock);
      files.release();
    } else unsettledLocks.add({ files, modelLock, root, child });
  }
}
/** Trusted owner only. A successful estimate is data, never an admitted memory report. */
export async function runPlacementEstimator(
  installed: InstalledPackage,
  model: string,
  temporaryDirectory: string,
  load: ClusterEffectiveLoad,
  signal: AbortSignal,
  inspection?: object,
): Promise<CandidateEstimate> {
  if (signal.aborted) throw Error('PLANNING_CANCELLED');
  const inventory = requireInstalledLive(installed);
  if (
    inventory.artifact !== load.artifact ||
    inventory.backend !== 'cuda' ||
    inventory.upstreamCommit !== '4f31296a907d73f3409f720429bcf31111615d77' ||
    !inventory.files.some((f) => f.path === 'llama-fit-params.exe')
  )
    throw Error('NEEDS_RESOURCE_EVIDENCE');
  const files = await revalidateInstalled(installed),
    native = ownershipBinding();
  let root: object | undefined, child: object | undefined, modelLock: object | undefined;
  try {
    modelLock = native.sealFiles([path.resolve(model)]);
    const retained = inspection === undefined ? undefined : inspections.get(inspection);
    if (inspection !== undefined && (!retained || retained.file !== path.resolve(model)))
      throw Error('INVALID_ESTIMATE');
    const info = retained?.info ?? (await inspectGGUF(model));
    if (info.sha256 !== load.modelSha256) throw Error('MODEL_FILE_UNAVAILABLE');
    if (info.contextLimit < load.contextPerSlot || info.blockCount !== load.blockCount)
      throw Error('INVALID_CONFIGURATION');
    if (signal.aborted) throw Error('PLANNING_CANCELLED');
    requireInstalledLive(installed);
    root = native.createDeployment();
    native.privateDirectory(temporaryDirectory);
    const executable = path.join(installed.directory, 'llama-fit-params.exe');
    child = native.launchCudaPlanConsole(
      root,
      path.join(installed.directory, inventory.helper),
      [executable, '--model', model, '--fit-print', 'on', ...clusterLoadArguments(load)],
      temporaryDirectory,
      load.placement.orderedUuids,
    );
    let output = '',
      captured = false;
    const deadline = Date.now() + 30000;
    for (;;) {
      if (signal.aborted) throw Error('PLANNING_CANCELLED');
      if (Date.now() >= deadline) throw Error('PLANNING_INCOMPLETE');
      const observation = native.observe(child);
      output += observation.output;
      if (Buffer.byteLength(output) > 65536) throw Error('INVALID_ESTIMATE');
      if (!captured && output.includes('\n')) {
        const match = /^ENGINE ([1-9][0-9]*)\r?$/u.exec(output.slice(0, output.indexOf('\n')));
        if (!match || !Number.isSafeInteger(Number(match[1])) || observation.exitCode !== -1)
          throw Error('INVALID_ESTIMATE');
        native.captureServer(child, Number(match[1]), executable);
        captured = true;
      }
      if (observation.exitCode !== -1 && observation.activeProcesses === 0) {
        if (observation.exitCode !== 0 || !captured) throw Error('INVALID_ESTIMATE');
        const rows = output.trimEnd().split(/\r?\n/u).slice(1);
        if (
          /^.{1,80} I llama_fit_params: printing estimated memory in MiB to stdout \(device, model, context, compute\) \.\.\.$/u.test(
            rows[0] ?? '',
          )
        )
          rows.shift();
        return parseClusterEstimate(Buffer.from(rows.join('\n')), load);
      }
      await delay(10);
    }
  } finally {
    // Never release package/model locks until all owned estimator processes exited.
    await settleEstimator(native, files, modelLock, root, child);
  }
}
