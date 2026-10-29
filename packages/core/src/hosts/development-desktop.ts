import path from 'node:path';
import { lstat } from 'node:fs/promises';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  DEVELOPMENT_BUILD,
  DEVELOPMENT_MEMORY_REPORTS,
} from '../runtime-package/development-policy.js';
import { createDevelopmentRuntimeVerifier } from '../runtime-package/verifier.js';
import { installExpanded, requireInstalledLive } from '../runtime-package/install.js';
import type { InstalledPackage } from '../runtime-package/install.js';
import { inspectGGUF, inspectGGUFHeader } from '../runtime/gguf.js';
import { LIFECYCLE_POLICY, REMOTE_STARTUP_MS } from '../runtime/contracts.js';
import { GENERATION_POLICY } from '../generation/contracts.js';
import { withPeerActivity } from '../generation/peer-activity-transport.js';
import { checkCudaResources } from '../runtime/gpu-resources.js';
import { discoverResources } from './resource-probe.js';
import { confirmExit, ownershipBinding } from './windows-ownership.js';
import { realEngineAdapter } from './real-engine.js';
import { createDesktopEngineHost } from './desktop.js';
import type { UtilityFork } from './desktop.js';
import { createDesktopPeerHost } from '../peers/desktop.js';
import type { DesktopPeerHost } from '../peers/desktop.js';
import type { PeerOverlay } from '../peers/overlay.js';
import type { PeerReply } from '../peers/wire.js';
import { decodePeerHardware } from '../peers/hardware.js';
import type { PeerHardware } from '../peers/hardware.js';
import { decodeClusterDevice, qualifyPeerGpu } from '../cluster/device-id.js';
import type { ResourceSnapshot } from '../runtime/gpu-resources.js';
import type { ModelSource } from '../model-configuration/model-source.js';
import type { ModelConfigurationRecord } from '../model-configuration/contracts.js';
import type { ClusterDraft, SavedClusterConfiguration, GpuRun } from '../cluster/contracts.js';
import { resolveClusterLoad } from '../cluster/effective-load.js';
import { autoPlace } from '../cluster/auto-place.js';
import {
  createStockClusterReport,
  checkStockClusterResources,
  requireStockClusterProfile,
} from '../cluster/stock-profile.js';
import type { StockClusterReport } from '../cluster/stock-profile.js';
import { runPlacementEstimator, withPlacementModel } from './placement-estimator.js';
import { createTensorCacheSettings } from '../tensor-cache/settings.js';
import { requireCompatibleRpcRuntime } from '../peers/resources.js';
/** Explicit Windows development deployment. Trusted main selects fixed build assets and state;
 * renderer commands cannot choose a repository, verifier, report, executable or arguments.
 * Ordinary builds keep the development verifier closed. Production packaging is separate.
 */
export function developmentDesktopDependencies(
  fork: UtilityFork,
  base: string,
  applicationData?: string,
  caller?: string,
  stateBase: string = base,
  overlay?: PeerOverlay,
) {
  const report = DEVELOPMENT_MEMORY_REPORTS.find((entry) => entry.configuration.slots === 4);
  if (!DEVELOPMENT_BUILD || !report) throw new Error('DEVELOPMENT_BUILD_REQUIRED');
  const configuration = report.configuration,
    modelSha256 = report.modelSha256;
  const deploymentId = `desktop-development-${randomUUID()}`;
  const tensorCache = createTensorCacheSettings(
    path.join(stateBase, 'tensor-cache-settings.json'),
    path.join(stateBase, 'tensor-cache-data'),
  );
  let verifiedBackends: readonly string[] | undefined;
  let sharedMemoryConfirmed = false;
  let preflightGeneration = 0;
  let installation: Promise<InstalledPackage> | undefined;
  let peerHost: Promise<DesktopPeerHost> | undefined;
  let peerHardware: PeerHardware | undefined;
  const peerListeners = new Set<(reply: PeerReply) => void>();
  let peersClosed = false;
  const getPeerHost = () => {
    if (!applicationData || !caller || peersClosed) throw new Error('NOT_READY');
    if (!peerHost) {
      // Applying inheritable ACLs is synchronous. Set them before creating the
      // owned host, rather than blocking the GUI on every telemetry/state read.
      ownershipBinding().privateDirectory(path.resolve(stateBase));
      peerHost = createDesktopPeerHost(fork, applicationData, caller, {
        bootstrap: path.join(base, 'peers'),
        state: path.join(stateBase, 'peers'),
      })
        .then(async (host) => {
          if (overlay) host.attachOverlay?.(overlay);
          host.subscribe((reply) => {
            for (const listener of peerListeners) listener(reply);
          });
          if (peerHardware) await host.updateHardware(peerHardware);
          return host;
        })
        .catch((error) => {
          peerHost = undefined;
          throw error;
        });
    }
    return peerHost;
  };
  async function clusterResources(
    ids: readonly string[],
    signal: AbortSignal,
  ): Promise<ResourceSnapshot> {
    const local = await discoverResources(signal);
    const remote = ids.filter((id) => decodeClusterDevice(id).kind === 'peer');
    if (!remote.length) return local;
    const owner = await getPeerHost();
    const expected = await owner.resources(null);
    const coordinator = requireInstalledLive(await installClusterRuntime());
    const observed = await Promise.all(
      remote.map(async (id) => {
        const device = decodeClusterDevice(id);
        if (device.kind !== 'peer') throw Error('INVALID_CLUSTER_DEVICE');
        const report = await owner.resources(id);
        if (signal.aborted) throw Error('PLANNING_CANCELLED');
        requireCompatibleRpcRuntime(coordinator, expected, report);
        if (report.ram < 1536 * 1048576) throw Error('INSUFFICIENT_RESOURCES');
        const matches = report.gpus.filter(
          (gpu) => gpu.uuid.toLowerCase() === device.uuid.toLowerCase(),
        );
        if (matches.length !== 1) throw Error('GPU_NOT_SHARED');
        return { ...matches[0]!, uuid: id };
      }),
    );
    return { ram: local.ram, gpus: [...(local.gpus ?? []), ...observed] };
  }
  const openPeer = async (device: string) => (await getPeerHost()).openRpc(device);
  const reservePlanningLocal =
    applicationData && caller
      ? async (devices: readonly string[]) => {
          const peer = await getPeerHost();
          await peer.setRuntimeBusy(true);
          let lease;
          try {
            lease = await peer.reserveLocal(devices);
          } catch (error) {
            await peer.setRuntimeBusy(false);
            throw error;
          }
          return {
            async release() {
              await lease.release();
              await peer.setRuntimeBusy(false);
            },
          };
        }
      : undefined;
  const installClusterRuntime = async () => {
    installation ??= (async () => {
      const capability = await createDevelopmentRuntimeVerifier().verify(
        path.join(base, 'repository'),
        path.join(stateBase, 'desktop-verification'),
      );
      return installExpanded(
        capability,
        path.join(base, 'candidate'),
        path.join(stateBase, 'installed'),
      );
    })();
    try {
      const installed = await installation;
      requireInstalledLive(installed);
      // Estimation and engine launch independently revalidate and seal every installed file.
      return installed;
    } catch (error) {
      installation = undefined;
      throw error;
    }
  };
  async function estimateCluster(
    file: string,
    saved: SavedClusterConfiguration,
    signal: AbortSignal,
  ) {
    const load = resolveClusterLoad(saved, report!.artifact);
    requireStockClusterProfile(load);
    const installed = await installClusterRuntime();
    return withPlacementModel(file, async (info, inspection) => {
      if (
        info.sha256 !== load.modelSha256 ||
        info.blockCount !== load.blockCount ||
        load.contextPerSlot > info.contextLimit
      )
        throw Error('INVALID_CONFIGURATION');
      return createStockClusterReport(
        load,
        await runPlacementEstimator(
          installed,
          file,
          path.join(stateBase, 'planning-cache'),
          load,
          signal,
          inspection,
          openPeer,
          reservePlanningLocal,
        ),
        info.nextnPredictLayers ?? 0,
      );
    });
  }
  /** History has its own retained core containment, independent of verified engine assets.
   * The engine adapter is prepared only by trusted main after import/resource admission.
   * Both owners close on core failure or Quit; no synthetic engine is supplied at startup.
   */
  async function createHistoryHost(source?: ModelSource) {
    const selectedConfiguration = source
      ? {
          ...configuration,
          modelSha256: source.modelId,
          contextPerSlot: Math.min(configuration.contextPerSlot, source.contextLimit),
        }
      : configuration;
    const native = ownershipBinding(),
      root = native.createDeployment();
    let adapter: ReturnType<typeof realEngineAdapter> | undefined;
    const activityTransports = new WeakMap<object, ReturnType<typeof withPeerActivity>>();
    let localGpuIds: readonly string[] = [];
    let startupMs: number = LIFECYCLE_POLICY.startupMs;
    let leaseExit: Promise<void> | undefined;
    let preparedFile: string | undefined, preparedFingerprint: string | undefined;
    let preparation: Promise<void> | undefined;
    let closed = false,
      closing: Promise<void> | undefined;
    const close = () => {
      if (closing) return closing;
      closed = true;
      native.closeDeployment(root);
      closing = (async () => {
        try {
          await preparation;
        } catch {
          /* Failed preparation cannot authorize launch. */
        }
        await Promise.all([adapter?.close(), confirmExit(() => native.coresExited(root))]);
        await leaseExit;
      })();
      return closing;
    };
    const prepare = (
      file: string,
      selected?: SavedClusterConfiguration,
      budget?: StockClusterReport,
      allowSharedMemory = false,
      confirmMemory?: () => Promise<boolean>,
    ) => {
      const previous = preparation ?? Promise.resolve();
      preparation = previous
        .catch(() => undefined)
        .then(async () => {
          if (closed) throw new Error('CORE_EXITED');
          const load = selected ? resolveClusterLoad(selected, report!.artifact) : undefined;
          if (!selected && adapter && preparedFile === file && preparedFingerprint === undefined)
            return;
          await adapter?.close();
          adapter = undefined;
          preparedFile = undefined;
          native.privateDirectory(path.resolve(stateBase));
          const installed = await installClusterRuntime();
          const inventory = requireInstalledLive(installed);
          verifiedBackends = [`${inventory.backend} (${inventory.version})`];
          if (closed) throw new Error('CORE_EXITED');
          let clusterConsent = allowSharedMemory;
          adapter = realEngineAdapter(
            installed,
            file,
            load
              ? {
                  ...selectedConfiguration,
                  modelSha256: load.modelSha256,
                  contextPerSlot: load.contextPerSlot,
                  slots: load.slots,
                  gpuLayers: load.blockCount + 1,
                  gpuDevice: decodeClusterDevice(load.placement.orderedUuids[0]!).uuid,
                  cacheK: load.cacheK,
                  cacheV: load.cacheV,
                }
              : selectedConfiguration,
            18478,
            () => {
              if (load) {
                const confirmed = clusterConsent;
                clusterConsent = false;
                return confirmed;
              }
              const confirmed = sharedMemoryConfirmed;
              sharedMemoryConfirmed = false;
              return confirmed;
            },
            load && budget
              ? {
                  load,
                  report: budget,
                  ...(confirmMemory ? { confirmMemory } : {}),
                  ...(load.placement.orderedUuids.some(
                    (id) => decodeClusterDevice(id).kind === 'peer',
                  )
                    ? {
                        peers: {
                          open: openPeer,
                          resources: (signal: AbortSignal) =>
                            clusterResources(load.placement.orderedUuids, signal),
                        },
                      }
                    : {}),
                }
              : undefined,
          );
          localGpuIds = load
            ? load.placement.orderedUuids.filter((id) => decodeClusterDevice(id).kind === 'local')
            : selectedConfiguration.gpuDevice
              ? [selectedConfiguration.gpuDevice]
              : [];
          preparedFile = file;
          preparedFingerprint = load?.fingerprint;
          startupMs = load?.placement.orderedUuids.some(
            (id) => decodeClusterDevice(id).kind === 'peer',
          )
            ? REMOTE_STARTUP_MS
            : LIFECYCLE_POLICY.startupMs;
        });
      return preparation;
    };
    try {
      const host = await createDesktopEngineHost(
        fork,
        {
          startupMs: () => startupMs,
          adapter: {
            async launch(selection, signal) {
              if (closed || !adapter) throw new Error('NOT_READY');
              await leaseExit;
              const peer = applicationData && caller ? await getPeerHost() : undefined;
              await peer?.setRuntimeBusy(true);
              let lease: { release(): Promise<void> } | undefined;
              try {
                lease = localGpuIds.length ? await peer?.reserveLocal(localGpuIds) : undefined;
                const engine = await adapter.launch(selection, signal);
                leaseExit = engine.exited.then(async () => {
                  await lease?.release();
                  await peer?.setRuntimeBusy(false);
                });
                void leaseExit.catch(() => undefined);
                await peer?.setRuntimeBusy(false);
                return engine;
              } catch (error) {
                // A failed launch cannot release hardware until its adapter proves exit.
                await adapter.close();
                await lease?.release();
                await peer?.setRuntimeBusy(false);
                throw error;
              }
            },
          },
          children: () => adapter?.children() ?? [],
          admitCore: (pid, image, time) => {
            if (closed) throw new Error('OWNERSHIP_FAILED');
            native.admitCore(root, pid, image, time);
          },
          close,
          ...(applicationData && caller
            ? {
                chat: (engine: Parameters<ReturnType<typeof realEngineAdapter>['chat']>[0]) => {
                  if (closed || !adapter) throw new Error('NOT_READY');
                  let transport = activityTransports.get(engine);
                  if (!transport) {
                    const peer = getPeerHost();
                    transport = withPeerActivity(adapter.chat(engine), async (busy) => {
                      // Quit closes admission, but existing work still owes its idle acknowledgement.
                      await (await (busy ? getPeerHost() : peer)).setRuntimeBusy(busy);
                    });
                    activityTransports.set(engine, transport);
                  }
                  return transport;
                },
                chatSetup: {
                  applicationData,
                  caller,
                  provenance: {
                    packageId: 'llama-cuda-development',
                    upstreamCommit: '4f31296a907d73f3409f720429bcf31111615d77',
                    configuration: selectedConfiguration,
                  },
                },
              }
            : {}),
        },
        deploymentId,
        {
          deploymentId,
          packageId: 'llama-cuda-development',
          modelId: source?.modelId ?? modelSha256,
        },
      );
      return {
        ...host,
        prepare,
        prepareCluster: (
          file: string,
          saved: SavedClusterConfiguration,
          budget: StockClusterReport,
          allowSharedMemory: boolean,
          confirmMemory?: () => Promise<boolean>,
        ) => prepare(file, saved, budget, allowSharedMemory, confirmMemory),
      };
    } catch (error) {
      await close();
      throw error;
    }
  }
  const dependencies = {
    subscribePeers(listener: (reply: PeerReply) => void) {
      peerListeners.add(listener);
      return () => peerListeners.delete(listener);
    },
    async updatePeerHardware(hardware: PeerHardware): Promise<void> {
      peerHardware = decodePeerHardware(hardware);
      if (peerHost && !peersClosed) await (await peerHost).updateHardware(peerHardware);
    },
    async peers(input: unknown): Promise<PeerReply> {
      if (!applicationData || !caller || peersClosed) return { ok: false, error: 'NOT_READY' };
      return (await getPeerHost()).command(caller, input);
    },
    async beginPeerQuit(): Promise<void> {
      peersClosed = true;
      if (peerHost) {
        const reply = await (await peerHost).command(caller!, { action: 'stop-sharing' });
        if (!reply.ok) throw Error(reply.error);
      }
    },
    async closePeers(): Promise<void> {
      peersClosed = true;
      peerListeners.clear();
      if (peerHost) await (await peerHost).close();
    },
    /** Installed and verifier-accepted inventory only; hardware brands do not imply backend support. */
    runtimeBackends: () => verifiedBackends,
    enabled: true as const,
    expectedHash: report.modelSha256,
    packageId: 'llama-cuda-development',
    clusterArtifact: report.artifact,
    async planCluster(
      file: string,
      draft: ClusterDraft,
      blockCount: number,
      signal: AbortSignal,
      devices?: readonly string[],
    ) {
      return withPlacementModel(file, async (info, inspection) => {
        if (info.sha256 !== draft.modelId || info.blockCount !== blockCount)
          throw Error('MODEL_FILE_UNAVAILABLE');
        const installed = await installClusterRuntime();
        const local = await discoverResources(signal);
        const approved =
          applicationData &&
          caller &&
          (!devices || devices.some((id) => decodeClusterDevice(id).kind === 'peer'))
            ? await (await getPeerHost()).command(caller, { action: 'read' })
            : null;
        const remoteIds = (
          approved?.ok
            ? approved.view.outgoing.flatMap((peer) =>
                peer.phase === 'approved' && peer.localVerified && peer.remoteVerified
                  ? peer.gpus.map((gpu) => qualifyPeerGpu(peer.peerFingerprint, gpu.id))
                  : [],
              )
            : []
        )
          .filter((id) => !devices || devices.includes(id))
          .slice(0, 2);
        const snapshot = remoteIds.length ? await clusterResources(remoteIds, signal) : local;
        const ids =
          snapshot.gpus
            ?.filter(
              (g) =>
                (!devices || devices.includes(g.uuid)) &&
                g.total !== null &&
                g.free !== null &&
                g.mig !== 'Enabled',
            )
            .sort((a, b) => b.free! - a.free!)
            .slice(0, 2)
            .map((g) => g.uuid) ?? [];
        let overflow: { runs: readonly GpuRun[]; pressure: number } | undefined;
        let evaluated = 0;
        const ordered = [...ids].sort();
        const free = ordered.map((uuid) => snapshot.gpus!.find((g) => g.uuid === uuid)!.free!);
        const preferredCut =
          free.length === 2
            ? Math.max(
                1,
                Math.min(
                  blockCount - 1,
                  Math.round((blockCount * free[0]!) / Math.max(1, free[0]! + free[1]!)),
                ),
              )
            : undefined;
        const result = await autoPlace(
          blockCount,
          ids,
          async (runs) => {
            if (++evaluated > 10) return null;
            const saved: SavedClusterConfiguration = {
              id: randomUUID(),
              name: 'Auto assign',
              revision: 1,
              modelId: draft.modelId,
              blockCount,
              profileId: 'b11306-four-slot',
              load: draft.load,
              runs,
            };
            const load = resolveClusterLoad(saved, report.artifact);
            requireStockClusterProfile(load);
            const budget = createStockClusterReport(
              load,
              await runPlacementEstimator(
                installed,
                file,
                path.join(stateBase, 'planning-cache'),
                load,
                signal,
                inspection,
                openPeer,
                reservePlanningLocal,
              ),
              info.nextnPredictLayers ?? 0,
            );
            const fresh = await clusterResources(load.placement.orderedUuids, signal);
            const admission = checkStockClusterResources(load, budget, fresh);
            if (
              admission.code === 'NEEDS_RESOURCE_EVIDENCE' ||
              admission.code === 'INCOMPATIBLE_DRIVER'
            )
              throw Error(admission.code);
            const pressure = Math.max(
              ...budget.devices.map(
                (d) => d.bytes / Math.max(1, fresh.gpus!.find((g) => g.uuid === d.uuid)!.free!),
              ),
            );
            if (
              admission.code === 'SHARED_GPU_MEMORY_CONFIRMATION' &&
              (!overflow || pressure < overflow.pressure)
            )
              overflow = { runs, pressure };
            return admission.code === 'ADMITTED'
              ? {
                  runs,
                  pressure: Math.max(
                    ...budget.devices.map(
                      (d) => d.bytes / fresh.gpus!.find((g) => g.uuid === d.uuid)!.free!,
                    ),
                  ),
                }
              : null;
          },
          signal,
          Date.now() + (remoteIds.length ? GENERATION_POLICY.generationMs : 120000),
          preferredCut,
        );
        if (result.code === 'PROPOSED') return result.runs;
        if (overflow && (result.code === 'NO_FIT' || result.code === 'INCOMPLETE'))
          return overflow.runs;
        throw Error(
          result.code === 'CANCELLED'
            ? 'PLANNING_CANCELLED'
            : result.code === 'INCOMPLETE'
              ? 'PLANNING_INCOMPLETE'
              : 'INSUFFICIENT_RESOURCES',
        );
      });
    },
    async planModel(
      file: string,
      record: ModelConfigurationRecord,
      signal: AbortSignal,
    ): Promise<SavedClusterConfiguration> {
      const info = await inspectGGUF(file);
      if (info.sha256 !== record.modelId || !info.blockCount) throw Error('MODEL_FILE_UNAVAILABLE');
      const load = {
        defaults: record.load,
        preferences: record.preferences,
        cacheK: 'q8_0' as const,
        cacheV: record.load.flashAttention ? ('q8_0' as const) : ('f16' as const),
      };
      const runs = await dependencies.planCluster(
        file,
        {
          key: `model:${record.modelId}`,
          configurationId: null,
          modelId: record.modelId,
          revision: record.revision,
          baseSavedRevision: null,
          load,
          runs: [],
        },
        info.blockCount,
        signal,
      );
      return {
        id: randomUUID(),
        name: 'Model defaults',
        revision: record.revision,
        modelId: record.modelId,
        blockCount: info.blockCount,
        profileId: 'b11306-four-slot',
        load,
        runs,
      };
    },
    async preflightCluster(
      file: string,
      saved: SavedClusterConfiguration,
      signal: AbortSignal,
      allowSharedMemory = false,
    ) {
      const budget = await estimateCluster(file, saved, signal);
      const admission = checkStockClusterResources(
        resolveClusterLoad(saved, report.artifact),
        budget,
        await clusterResources(
          saved.runs.map((run) => run.uuid),
          signal,
        ),
        allowSharedMemory,
      );
      if (admission.code !== 'ADMITTED') throw Error(admission.code);
      return budget;
    },
    deploymentId,
    async inspect(file: string) {
      const native = ownershipBinding();
      const lock = native.sealFiles([path.resolve(file)]);
      try {
        const info = await inspectGGUF(file);
        const stat = await lstat(file);
        return {
          ...info,
          size: `${(stat.size / 1e9).toFixed(2)} GB`,
          sizeBytes: stat.size,
          modifiedMs: stat.mtimeMs,
        };
      } finally {
        native.releaseFiles(lock);
      }
    },
    /** Reclassify legacy discovery metadata under the existing file seal, without reading payloads. */
    async reinspect(source: ModelSource): Promise<ModelSource | null> {
      const native = ownershipBinding();
      let lock: ReturnType<typeof native.sealFiles> | undefined;
      try {
        lock = native.sealFiles([source.file]);
        const stat = await lstat(source.file);
        if (!stat.isFile() || stat.size !== source.sizeBytes || stat.mtimeMs !== source.modifiedMs)
          return null;
        const info = await inspectGGUFHeader(source.file);
        const corrected = {
          ...source,
          architecture: info.architecture,
          contextLimit: info.contextLimit,
          blockCount: info.blockCount,
          classificationVersion: 1 as const,
        };
        if (info.speculativeHead) corrected.speculativeHead = info.speculativeHead;
        else delete corrected.speculativeHead;
        return corrected;
      } catch {
        return null;
      } finally {
        if (lock) native.releaseFiles(lock);
      }
    },
    /** Reconcile a saved source without hashing/loading a large model during startup. */
    async available(source: ModelSource): Promise<boolean> {
      const native = ownershipBinding();
      let lock: ReturnType<typeof native.sealFiles> | undefined;
      try {
        lock = native.sealFiles([source.file]);
        const stat = await lstat(source.file);
        return (
          stat.isFile() && stat.size === source.sizeBytes && stat.mtimeMs === source.modifiedMs
        );
      } catch {
        return false;
      } finally {
        if (lock) native.releaseFiles(lock);
      }
    },
    async device() {
      const snapshot = await discoverResources();
      const gpu =
        snapshot.gpus?.find((g) => g.uuid === report.configuration.gpuDevice) ??
        snapshot.gpus?.find((g) => g.total !== null);
      return {
        name: os.hostname(),
        os: 'Windows',
        cpuName: os.cpus()[0]?.model ?? 'CPU',
        threads: os.cpus().length,
        ...(gpu?.total != null
          ? { gpuMemoryGiB: gpu.total / 2 ** 30, ...(gpu.name ? { gpuName: gpu.name } : {}) }
          : {}),
      };
    },
    async preflight(allowSharedMemory = false) {
      const generation = ++preflightGeneration;
      sharedMemoryConfirmed = false;
      const result = checkCudaResources(
        report.configuration,
        report.artifact,
        report,
        await discoverResources(),
        '551.78',
        allowSharedMemory,
      );
      if (generation !== preflightGeneration) throw new Error('START_FAILED');
      if (result.code !== 'ADMITTED') throw new Error(result.code);
      sharedMemoryConfirmed = allowSharedMemory;
    },
    createHistoryHost,
    async createHost(file: string) {
      const host = await createHistoryHost();
      try {
        await host.prepare(file);
        return host;
      } catch (error) {
        await host.command(JSON.stringify({ id: 1, action: 'quit' }));
        await host.close();
        throw error;
      }
    },
  };
  return { ...dependencies, tensorCache };
}
