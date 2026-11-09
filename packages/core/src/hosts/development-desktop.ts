import {
  VULKAN_DEVELOPMENT,
  isDevelopmentVulkanInventory,
} from '../runtime-package/development-vulkan.js';
import path from 'node:path';
import { lstat, writeFile, rename, unlink } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  DEVELOPMENT_BUILD,
  DEVELOPMENT_MEMORY_REPORTS,
} from '../runtime-package/development-policy.js';
import {
  createDevelopmentRuntimeVerifier,
  requireLivePackage,
} from '../runtime-package/verifier.js';
import {
  hasRuntimeInstallation,
  installInRuntimeStore,
  requireInstalledLive,
} from '../runtime-package/install.js';
import {
  B11307_DEVELOPMENT,
  B11307_WORKER_FIRST_LAYER,
  isDevelopmentB11307Device,
  isDevelopmentB11307Inventory,
  isQualifiedDevelopmentB11307Load,
} from '../runtime-package/development-b11307.js';
import { describeRuntime } from '../runtime-package/inventory.js';
import { APPROVED_MEMORY_REPORTS } from '../runtime-package/trust-policy.js';
import type { createDesktopRuntimeCatalog } from '../runtime-package/catalog-management.js';
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
import { decodePeerCommand } from '../peers/wire.js';
import type { PeerCommand, PeerReply } from '../peers/wire.js';
import { decodePeerHardware } from '../peers/hardware.js';
import type { PeerHardware } from '../peers/hardware.js';
import { decodeClusterDevice, qualifyPeerGpu } from '../cluster/device-id.js';
import type { ResourceSnapshot } from '../runtime/gpu-resources.js';
import type { ModelSource } from '../model-configuration/model-source.js';
import type { ModelConfigurationRecord } from '../model-configuration/contracts.js';
import type { ClusterDraft, SavedClusterConfiguration, GpuRun } from '../cluster/contracts.js';
import { MAX_CLUSTER_GPUS } from '../cluster/contracts.js';
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
import { executionDevices } from '../speculative-decoding/execution.js';
import type { SpeculativeCompanion } from '../speculative-decoding/assets.js';
import type { RuntimeDiagnostic } from './runtime-diagnostics.js';
type RuntimeBuildId = 'b11306' | 'b11307' | 'b11306-vulkan';

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
  diagnostic?: RuntimeDiagnostic,
  runtimeStore?: string,
  pairedBuild = false,
  release?: ReturnType<typeof createDesktopRuntimeCatalog>,
) {
  const report = (release ? APPROVED_MEMORY_REPORTS : DEVELOPMENT_MEMORY_REPORTS).find(
    (entry) => entry.configuration.slots === 4,
  );
  if (!release && (!DEVELOPMENT_BUILD || !report)) throw new Error('DEVELOPMENT_BUILD_REQUIRED');
  if (!report) throw new Error('NEEDS_RESOURCE_EVIDENCE');
  const configuration = report.configuration,
    modelSha256 = report.modelSha256;
  const initialBase = base;
  const runtimeChoices =
    runtimeStore && !release
      ? {
          b11306: pairedBuild ? path.join(path.dirname(initialBase), 'b11306') : initialBase,
          b11307: pairedBuild ? initialBase : path.join(path.dirname(initialBase), 'b11307'),
          'b11306-vulkan': path.join(path.dirname(initialBase), 'b11306-vulkan'),
        }
      : undefined;
  const choiceFile =
    applicationData && runtimeChoices
      ? path.join(applicationData, 'runtime-choice.json')
      : undefined;
  let selectedBuild: RuntimeBuildId = pairedBuild ? 'b11307' : 'b11306';
  if (choiceFile) {
    try {
      const choice: unknown = JSON.parse(readFileSync(choiceFile, 'utf8'));
      if (choice === 'b11306' || choice === 'b11307' || choice === 'b11306-vulkan')
        selectedBuild = choice;
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
        diagnostic?.('app', 'runtime.preference-unavailable');
    }
    pairedBuild = selectedBuild === 'b11307';
    base = runtimeChoices![selectedBuild];
  }
  let activeBuild = selectedBuild;
  let activeReleaseBackend: 'cuda' | 'vulkan' | undefined;
  let artifact = release
    ? ''
    : selectedBuild === 'b11306-vulkan'
      ? VULKAN_DEVELOPMENT.artifact
      : pairedBuild
        ? B11307_DEVELOPMENT.artifact
        : report.artifact;
  let packageId = release
    ? ''
    : selectedBuild === 'b11306-vulkan'
      ? VULKAN_DEVELOPMENT.packageId
      : pairedBuild
        ? B11307_DEVELOPMENT.packageId
        : 'llama-cuda-development';
  let upstreamCommit = pairedBuild
    ? B11307_DEVELOPMENT.upstreamCommit
    : '4f31296a907d73f3409f720429bcf31111615d77';
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
  let sharing: Extract<PeerCommand, { action: 'share' }> | undefined;
  let peerChanges = Promise.resolve();
  function changePeerOwner<T>(operation: () => Promise<T>): Promise<T> {
    const next = peerChanges.then(operation);
    peerChanges = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
  const getPeerHost = () => {
    if (!applicationData || !caller || peersClosed) throw new Error('NOT_READY');
    if (!peerHost) {
      // Applying inheritable ACLs is synchronous. Set them before creating the
      // owned host, rather than blocking the GUI on every telemetry/state read.
      const native = ownershipBinding();
      native.privateDirectory(path.resolve(stateBase));
      const peerState = path.join(stateBase, 'peers');
      let verificationState: string | undefined;
      if (base !== initialBase) {
        // The verifier can create its own directory only after its ancestors exist.
        const verificationParent = stateBase === initialBase ? path.join(base, 'peers') : peerState;
        native.privateDirectory(path.resolve(verificationParent));
        const verificationRoot = path.join(verificationParent, 'peer-verification');
        if (stateBase !== initialBase) native.privateDirectory(path.resolve(verificationRoot));
        verificationState =
          stateBase === initialBase ? verificationRoot : path.join(verificationRoot, activeBuild);
      }
      peerHost = (async () => {
        const selected = release && !activeReleaseBackend ? await release.selected() : undefined;
        const backend =
          activeReleaseBackend ?? (selected ? requireInstalledLive(selected).backend : 'none');
        if (backend === 'cpu') throw Error('UNSUPPORTED_RUNTIME');
        return createDesktopPeerHost(fork, applicationData, caller, {
          bootstrap:
            pairedBuild || activeBuild === 'b11306-vulkan' ? base : path.join(base, 'peers'),
          state: peerState,
          ...(verificationState ? { verificationState } : {}),
          ...(runtimeStore ? { runtimeStore } : {}),
          ...(release ? { releaseBackend: backend } : {}),
        });
      })()
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
  const legacyRoot = path.join(stateBase, 'installed');
  const installedRoot = runtimeStore ?? legacyRoot;
  let verifying:
    ReturnType<ReturnType<typeof createDevelopmentRuntimeVerifier>['verify']> | undefined;
  // Switched repositories have independent metadata versions. Reuse their existing picker history.
  function verifyRuntime() {
    if (base !== initialBase) return verifyChoice(activeBuild);
    return (verifying ??= createDevelopmentRuntimeVerifier()
      .verify(path.join(base, 'repository'), path.join(stateBase, 'desktop-verification'))
      .then((capability) => {
        if (
          (pairedBuild &&
            !isDevelopmentB11307Inventory(requireLivePackage(capability).inventory)) ||
          (activeBuild === 'b11306-vulkan' &&
            !isDevelopmentVulkanInventory(requireLivePackage(capability).inventory))
        )
          throw Error('UNSUPPORTED_RUNTIME');
        return capability;
      })
      .finally(() => {
        verifying = undefined;
      }));
  }
  const choiceVerification = new Map<RuntimeBuildId, NonNullable<typeof verifying>>();
  function verifyChoice(build: RuntimeBuildId) {
    if (!runtimeChoices) return Promise.reject(Error('UNSUPPORTED_RUNTIME'));
    const pending = choiceVerification.get(build);
    if (pending) return pending;
    ownershipBinding().privateDirectory(path.resolve(stateBase, 'runtime-selection'));
    const verification = createDevelopmentRuntimeVerifier()
      .verify(
        path.join(runtimeChoices[build], 'repository'),
        path.join(stateBase, 'runtime-selection', build),
      )
      .then((capability) => {
        const inventory = requireLivePackage(capability).inventory;
        if (
          build === 'b11307'
            ? !isDevelopmentB11307Inventory(inventory)
            : build === 'b11306-vulkan'
              ? !isDevelopmentVulkanInventory(inventory)
              : inventory.packageId !== 'llama-cuda-development' ||
                inventory.upstreamCommit !== '4f31296a907d73f3409f720429bcf31111615d77' ||
                inventory.artifact !== report!.artifact
        )
          throw Error('UNSUPPORTED_RUNTIME');
        return capability;
      })
      .finally(() => {
        choiceVerification.delete(build);
      });
    choiceVerification.set(build, verification);
    return verification;
  }
  async function runtimeSelection() {
    if (release) {
      const installed = await release.selected();
      if (!installed) throw new Error('MISSING_RUNTIME');
      return describeRuntime(requireInstalledLive(installed));
    }
    const capability = runtimeChoices ? await verifyChoice(selectedBuild) : await verifyRuntime();
    return describeRuntime(requireLivePackage(capability).inventory);
  }
  async function selectRuntime(build: RuntimeBuildId) {
    const capability = await verifyChoice(build);
    if (!choiceFile) throw Error('UNSUPPORTED_RUNTIME');
    const temporary = choiceFile + '.' + randomUUID() + '.tmp';
    ownershipBinding().privateDirectory(path.dirname(choiceFile));
    try {
      await writeFile(temporary, JSON.stringify(build), { flag: 'wx' });
      await rename(temporary, choiceFile);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
    selectedBuild = build;
    inventoryIndex = undefined;
    return describeRuntime(requireLivePackage(capability).inventory);
  }
  function activateRuntime() {
    return changePeerOwner(replaceRuntime);
  }
  async function replaceRuntime() {
    if (peersClosed) throw Error('NOT_READY');
    const selected = release ? await release.selected() : undefined;
    if (release && !selected) throw Error('MISSING_RUNTIME');
    if (!release && activeBuild === selectedBuild) return null;
    const inventory = selected
      ? requireInstalledLive(selected)
      : requireLivePackage(await verifyChoice(selectedBuild)).inventory;
    if (release && inventory.backend === 'cpu') throw Error('UNSUPPORTED_RUNTIME');
    if (release && activeReleaseBackend === inventory.backend) return null;
    const hadPeerHost = !!peerHost;
    let resumeSharing: typeof sharing;
    if (peerHost) {
      const peer = await peerHost;
      const reply = await peer.command(caller!, { action: 'read' });
      if (!reply.ok) throw Error(reply.error);
      if (reply.view.sharing && sharing)
        resumeSharing = { ...sharing, gpuIds: [...reply.view.sharedGpuIds] };
      // Hold every local GPU until the old peer owner exits; an active worker keeps its build.
      if (reply.view.gpus.length) await peer.reserveLocal(reply.view.gpus.map((gpu) => gpu.id));
      await peer.close();
    }
    peerHost = undefined;
    if (peersClosed) throw Error('NOT_READY');
    if (release) {
      if (inventory.backend === 'cpu') throw Error('UNSUPPORTED_RUNTIME');
      activeReleaseBackend = inventory.backend;
    } else {
      pairedBuild = selectedBuild === 'b11307';
      base = runtimeChoices![selectedBuild];
      activeBuild = selectedBuild;
    }
    artifact = inventory.artifact;
    packageId = inventory.packageId;
    upstreamCommit = inventory.upstreamCommit;
    installation = undefined;
    verifying = undefined;
    verifiedBackends = undefined;
    if (hadPeerHost) {
      const peer = await getPeerHost();
      if (resumeSharing) {
        const reply = await peer.command(caller!, resumeSharing);
        if (!reply.ok) throw Error(reply.error);
      }
    }
    return describeRuntime(inventory);
  }
  type IndexedRuntime = {
    id: RuntimeBuildId;
    capability: Awaited<ReturnType<typeof verifyRuntime>>;
    installed: boolean;
  };
  let inventoryIndex: Promise<readonly IndexedRuntime[]> | undefined;
  let inventoryStamp: string | undefined;
  async function runtimeInventory() {
    const stat = await lstat(installedRoot).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return undefined;
    });
    const stamp = stat ? `${stat.ino}:${stat.mtimeMs}:${stat.ctimeMs}` : 'missing';
    if (stamp !== inventoryStamp) {
      inventoryStamp = stamp;
      inventoryIndex = undefined;
    }
    // The index caches display metadata only. Activation, estimation and launch still reverify.
    inventoryIndex ??= Promise.all(
      (runtimeChoices ? (['b11307', 'b11306', 'b11306-vulkan'] as const) : [selectedBuild]).map(
        async (id): Promise<IndexedRuntime | undefined> => {
          try {
            const capability = runtimeChoices ? await verifyChoice(id) : await verifyRuntime();
            return {
              id,
              capability,
              installed: await hasRuntimeInstallation(capability, installedRoot),
            };
          } catch {
            diagnostic?.('app', 'runtime.choice-unavailable build=' + id);
            return undefined;
          }
        },
      ),
    ).then((rows) => rows.filter((row): row is IndexedRuntime => row !== undefined));
    const rows = await inventoryIndex;
    try {
      const selected = rows.find((row) => row.id === selectedBuild);
      if (!selected) throw Error('UNSUPPORTED_RUNTIME');
      const choices = rows
        .filter((row) => row.installed)
        .map((row) => ({
          id: row.id,
          build: describeRuntime(requireLivePackage(row.capability).inventory),
        }));
      return {
        selected: describeRuntime(requireLivePackage(selected.capability).inventory),
        installed: selected.installed,
        ...(runtimeChoices ? { choices } : {}),
      };
    } catch (error) {
      // Expired metadata or a failed read is retried, never retained as usable authority.
      inventoryIndex = undefined;
      throw error;
    }
  }
  const installClusterRuntime = async () => {
    if (release) {
      const installed = activeReleaseBackend && (await release.installed(activeReleaseBackend));
      if (!installed) throw Error('MISSING_RUNTIME');
      return installed;
    }
    const candidate = path.join(base, 'candidate');
    installation ??= verifyRuntime().then((capability) =>
      installInRuntimeStore(
        capability,
        candidate,
        installedRoot,
        runtimeStore ? legacyRoot : undefined,
      ),
    );
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
    companion?: SpeculativeCompanion,
  ) {
    const load = resolveClusterLoad(saved, artifact);
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
          companion,
        ),
        info.nextnPredictLayers ?? 0,
        companion,
      );
    });
  }
  /** History has its own retained core containment, independent of verified engine assets.
   * The engine adapter is prepared only by trusted main after import/resource admission.
   * Both owners close on core failure or Quit; no synthetic engine is supplied at startup.
   */
  async function createHistoryHost(source?: ModelSource, resumeClusterDrafts = false) {
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
    let preparedRuntime: ReturnType<typeof describeRuntime> | null = null;
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
          const load = selected ? resolveClusterLoad(selected, artifact) : undefined;
          if (!selected && adapter && preparedFile === file && preparedFingerprint === undefined)
            return;
          await adapter?.close();
          adapter = undefined;
          preparedRuntime = null;
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
                  ...(executionDevices(load).some((id) => decodeClusterDevice(id).kind === 'peer')
                    ? {
                        peers: {
                          open: openPeer,
                          resources: (signal: AbortSignal) =>
                            clusterResources(executionDevices(load), signal),
                        },
                      }
                    : {}),
                }
              : undefined,
            diagnostic,
          );
          localGpuIds = load
            ? executionDevices(load).filter((id) => decodeClusterDevice(id).kind === 'local')
            : selectedConfiguration.gpuDevice
              ? [selectedConfiguration.gpuDevice]
              : [];
          preparedRuntime = describeRuntime(inventory);
          preparedFile = file;
          preparedFingerprint = load?.fingerprint;
          startupMs =
            load && executionDevices(load).some((id) => decodeClusterDevice(id).kind === 'peer')
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
                  ...(resumeClusterDrafts ? { resumeClusterDrafts } : {}),
                  provenance: {
                    packageId,
                    upstreamCommit,
                    configuration: selectedConfiguration,
                  },
                },
              }
            : {}),
        },
        deploymentId,
        {
          deploymentId,
          packageId,
          modelId: source?.modelId ?? modelSha256,
        },
      );
      return {
        ...host,
        runtimePackage: () => preparedRuntime,
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
      const command = decodePeerCommand(input);
      if (command.action === 'share' || command.action === 'stop-sharing')
        return changePeerOwner(async () => {
          if (peersClosed) return { ok: false, error: 'NOT_READY' };
          const reply = await (await getPeerHost()).command(caller, command);
          if (reply.ok) sharing = command.action === 'share' ? command : undefined;
          return reply;
        });
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
    runtimeSelection,
    runtimeInventory,
    selectRuntime,
    activateRuntime,
    ...(release ? { runtimeCatalog: release.command } : {}),
    enabled: true as const,
    expectedHash: report.modelSha256,
    packageId,
    clusterArtifact: artifact,
    async planCluster(
      file: string,
      draft: ClusterDraft,
      blockCount: number,
      signal: AbortSignal,
      devices?: readonly string[],
      companion?: SpeculativeCompanion,
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
          .filter(
            (id) =>
              (!devices || devices.includes(id)) && (!pairedBuild || isDevelopmentB11307Device(id)),
          )
          .slice(0, MAX_CLUSTER_GPUS);
        const snapshot = remoteIds.length ? await clusterResources(remoteIds, signal) : local;
        const ids =
          snapshot.gpus
            ?.filter(
              (g) =>
                (!devices || devices.includes(g.uuid)) &&
                (!pairedBuild || isDevelopmentB11307Device(g.uuid)) &&
                g.total !== null &&
                g.free !== null &&
                g.mig !== 'Enabled',
            )
            .sort((a, b) => b.free! - a.free!)
            .slice(0, MAX_CLUSTER_GPUS)
            .map((g) => g.uuid) ?? [];
        let overflow: { runs: readonly GpuRun[]; pressure: number } | undefined;
        const ordered = [...ids].sort();
        const free = ordered.map((uuid) => snapshot.gpus!.find((g) => g.uuid === uuid)!.free!);
        const preferredCut = pairedBuild
          ? B11307_WORKER_FIRST_LAYER
          : free.length === 2
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
            const saved: SavedClusterConfiguration = {
              id: randomUUID(),
              name: 'Auto assign',
              revision: 1,
              modelId: draft.modelId,
              blockCount,
              profileId: 'b11306-four-slot',
              load: draft.load,
              runs,
              ...(draft.proposerDevice ? { proposerDevice: draft.proposerDevice } : {}),
            };
            const load = resolveClusterLoad(saved, artifact);
            if (pairedBuild && !isQualifiedDevelopmentB11307Load(load)) return null;
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
                companion,
              ),
              info.nextnPredictLayers ?? 0,
              companion,
            );
            const fresh = await clusterResources(executionDevices(load), signal);
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
          {
            maximumEvaluations: 64,
            weights: Object.fromEntries(ordered.map((id, i) => [id, free[i]!])),
          },
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
      companion?: SpeculativeCompanion,
    ): Promise<SavedClusterConfiguration> {
      const info = await inspectGGUF(file);
      if (info.sha256 !== record.modelId || !info.blockCount) throw Error('MODEL_FILE_UNAVAILABLE');
      const load = {
        defaults: record.load,
        preferences: record.preferences,
        ...(record.speculation ? { speculation: record.speculation } : {}),
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
        undefined,
        companion,
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
      companion?: SpeculativeCompanion,
    ) {
      const budget = await estimateCluster(file, saved, signal, companion);
      const admission = checkStockClusterResources(
        resolveClusterLoad(saved, artifact),
        budget,
        await clusterResources(executionDevices(resolveClusterLoad(saved, artifact)), signal),
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
          nextnPredictLayers: info.nextnPredictLayers ?? 0,
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
        artifact,
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
