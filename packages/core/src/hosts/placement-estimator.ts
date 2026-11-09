import path from 'node:path';
import { isDevelopmentVulkanInventory } from '../runtime-package/development-vulkan.js';
import { setTimeout as delay } from 'node:timers/promises';
import type { InstalledPackage } from '../runtime-package/install.js';
import { DEVELOPMENT_BUILD } from '../runtime-package/development-policy.js';
import {
  isDevelopmentB11307Inventory,
  isQualifiedDevelopmentB11307Load,
} from '../runtime-package/development-b11307.js';
import {
  installedRealm,
  requireInstalledLive,
  revalidateInstalled,
} from '../runtime-package/install.js';
import { inspectGGUF } from '../runtime/gguf.js';
import type { GGUFInfo } from '../runtime/gguf.js';
import { ownershipBinding, confirmExit } from './windows-ownership.js';
import { clusterLoadArguments } from '../cluster/effective-load.js';
import type { ClusterEffectiveLoad } from '../cluster/effective-load.js';
import { parseClusterEstimate } from '../cluster/estimate.js';
import type { CandidateEstimate } from '../cluster/estimate.js';
import { decodeClusterDevice } from '../cluster/device-id.js';
import { createPeerRelays } from './peer-relays.js';
import type { OpenPeerRpc } from './peer-relays.js';
import { GENERATION_POLICY } from '../generation/contracts.js';
import { executionDevices, speculativeArguments } from '../speculative-decoding/execution.js';
import { validateSpeculativeAssets } from '../speculative-decoding/assets.js';
import type { SpeculativeCompanion } from '../speculative-decoding/assets.js';
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
  retainOutput: (text: string) => void,
): Promise<void> {
  let cleaned = !child;
  try {
    if (root) native.closeDeployment(root);
    if (child) {
      await confirmExit(() => {
        const s = native.observe(child);
        retainOutput(s.output);
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
  openPeer?: OpenPeerRpc,
  reserveLocal?: (devices: readonly string[]) => Promise<{ release(): Promise<void> }>,
  companion?: SpeculativeCompanion,
): Promise<CandidateEstimate> {
  if (signal.aborted) throw Error('PLANNING_CANCELLED');
  const speculative = speculativeArguments(load, companion?.file);
  const inventory = requireInstalledLive(installed);
  if (
    load.speculation?.enabled &&
    !inventory.files.some((f) => f.path === 'modelloom-speculative-estimator.exe')
  )
    throw Error('NEEDS_SPECULATIVE_EVIDENCE');
  if (
    inventory.artifact !== load.artifact ||
    (inventory.backend !== 'cuda' &&
      !(
        isDevelopmentVulkanInventory(inventory) &&
        (installedRealm(installed) === 'live' ||
          (DEVELOPMENT_BUILD && installedRealm(installed) === 'development'))
      )) ||
    (inventory.upstreamCommit !== '4f31296a907d73f3409f720429bcf31111615d77' &&
      !(
        DEVELOPMENT_BUILD &&
        installedRealm(installed) === 'development' &&
        isDevelopmentB11307Inventory(inventory) &&
        isQualifiedDevelopmentB11307Load(load)
      )) ||
    !inventory.files.some(
      (f) =>
        f.path ===
        (load.speculation?.enabled
          ? 'modelloom-speculative-estimator.exe'
          : 'llama-fit-params.exe'),
    )
  )
    throw Error('NEEDS_RESOURCE_EVIDENCE');
  const files = await revalidateInstalled(installed),
    native = ownershipBinding();
  let root: object | undefined, child: object | undefined, modelLock: object | undefined;
  let relays: Awaited<ReturnType<typeof createPeerRelays>> | undefined;
  let reservation: { release(): Promise<void> } | undefined;
  let output = '';
  try {
    modelLock = native.sealFiles([
      path.resolve(model),
      ...(companion ? [path.resolve(companion.file)] : []),
    ]);
    const retained = inspection === undefined ? undefined : inspections.get(inspection);
    if (inspection !== undefined && (!retained || retained.file !== path.resolve(model)))
      throw Error('INVALID_ESTIMATE');
    const info = retained?.info ?? (await inspectGGUF(model));
    if (info.sha256 !== load.modelSha256) throw Error('MODEL_FILE_UNAVAILABLE');
    if (info.contextLimit < load.contextPerSlot || info.blockCount !== load.blockCount)
      throw Error('INVALID_CONFIGURATION');
    validateSpeculativeAssets(
      load.speculation,
      info,
      companion ? await inspectGGUF(companion.file) : undefined,
    );
    if (signal.aborted) throw Error('PLANNING_CANCELLED');
    requireInstalledLive(installed);
    const devices = executionDevices(load);
    const local = devices.filter((id) => decodeClusterDevice(id).kind === 'local');
    if (local.length) reservation = await reserveLocal?.(local);
    if (signal.aborted) throw Error('PLANNING_CANCELLED');
    root = native.createDeployment();
    native.privateDirectory(temporaryDirectory);
    const executable = path.join(
      installed.directory,
      load.speculation?.enabled ? 'modelloom-speculative-estimator.exe' : 'llama-fit-params.exe',
    );
    let captured = false,
      serverPid: number | undefined;
    const observe = () => {
      if (!child) throw Error('NOT_READY');
      const observation = native.observe(child);
      output += observation.output;
      if (Buffer.byteLength(output) > 65536) throw Error('INVALID_ESTIMATE');
      if (!captured && output.includes('\n')) {
        const match = /^ENGINE ([1-9][0-9]*)\r?$/u.exec(output.slice(0, output.indexOf('\n')));
        if (!match || !Number.isSafeInteger(Number(match[1])) || observation.exitCode !== -1)
          throw Error('INVALID_ESTIMATE');
        native.captureServer(child, Number(match[1]), executable);
        captured = true;
        serverPid = Number(match[1]);
      }
      return observation;
    };
    relays = await createPeerRelays(
      devices,
      (pid) => observe().exitCode === -1 && serverPid === pid,
      openPeer,
    );
    const args = [
      executable,
      '--model',
      model,
      ...(load.speculation?.enabled ? ['--fit', 'off'] : ['--fit-print', 'on']),
      ...relays.arguments,
      ...clusterLoadArguments(load),
      ...speculative,
    ];
    child = local.length
      ? native.launchCudaPlanConsole(
          root,
          path.join(installed.directory, inventory.helper),
          args,
          temporaryDirectory,
          local,
        )
      : native.launchConsole(
          root,
          path.join(installed.directory, inventory.helper),
          args,
          temporaryDirectory,
        );
    // Remote enumeration launches verified workers for several stock RPC queries.
    const remote = local.length !== devices.length;
    const deadline = Date.now() + (remote ? GENERATION_POLICY.generationMs : 30000);
    for (;;) {
      if (signal.aborted) throw Error('PLANNING_CANCELLED');
      if (Date.now() >= deadline) throw Error('PLANNING_INCOMPLETE');
      const observation = observe();
      if (observation.exitCode !== -1 && observation.activeProcesses === 0) {
        if (observation.exitCode !== 0 || !captured) throw Error('INVALID_ESTIMATE');
        const rows = output.trimEnd().split(/\r?\n/u).slice(1);
        if (load.speculation?.enabled) {
          const marker = rows.findIndex((row) => row.startsWith('MODELLOOM_SPEC_ESTIMATE '));
          if (marker < 0) throw Error('INVALID_ESTIMATE');
          return parseClusterEstimate(Buffer.from(rows.slice(marker).join('\n')), load);
        }
        // A remote-only coordinator can estimate RPC devices without a local CUDA device.
        if (
          !local.length &&
          /^\d+(?:\.\d+){3} E ggml_cuda_init: failed to initialize CUDA: no CUDA-capable device is detected$/u.test(
            rows[0] ?? '',
          )
        )
          rows.shift();
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
  } catch (failure) {
    if (!(failure instanceof Error)) throw failure;
    // Keep native diagnostics with the trusted owner; the renderer receives only the existing code.
    const reported = new Error(failure.message, { cause: failure });
    Object.defineProperty(reported, 'estimatorOutput', {
      get: () => output,
    });
    throw reported;
  } finally {
    // Never release package/model locks until all owned estimator processes exited.
    await Promise.allSettled([
      settleEstimator(native, files, modelLock, root, child, (text) => {
        output = (output + text).slice(-16384);
      }),
      relays?.close(),
    ]).then(async (cleanup) => {
      if (cleanup[0]?.status === 'fulfilled') await reservation?.release();
      if (cleanup.some((result) => result.status === 'rejected')) throw Error('CLEANUP_FAILED');
    });
  }
}
