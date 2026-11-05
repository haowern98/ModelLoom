import type { ModelLoadingStatus } from './model-loading-status';
import { randomUUID } from 'node:crypto';
import { toPeerHardware } from './peer-hardware';
import type { PeerHardware } from '../../../../packages/core/src/peers/hardware';
import { decodePeerCommand, decodePeerReply } from '../shared/peers';
import type { PeerReply } from '../shared/peers';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { decodeRuntimeCommand } from '../shared/runtime';
import type {
  RuntimeView,
  RuntimeDevice,
  RuntimeInventory,
  RuntimeBuildId,
} from '../shared/runtime';
import type { RuntimePackageDescription } from '../../../../packages/core/src/runtime-package/inventory';
import { decodeChatCommand } from '../shared/chat';
import type { ChatReply } from '../shared/chat';
import {
  decodeConfigurationCommand,
  decodeConfigurationReply,
} from '../shared/model-configuration';
import type { ConfigurationReply } from '../shared/model-configuration';
import { decodeApiManagementCommand, decodeApiManagementReply } from '../shared/local-api';
import type { ApiManagementReply } from '../shared/local-api';
import type { ApiOwnerReply } from '../../../../packages/core/src/local-api/wire';
import { decodeApiOwnerReply } from '../../../../packages/core/src/local-api/wire';
import { decodeModelSource } from '../../../../packages/core/src/model-configuration/model-source';
import type { ModelSource } from '../../../../packages/core/src/model-configuration/model-source';
import type { RuntimeModel } from '../shared/runtime';
import { decodeClusterCommand, decodeClusterReply } from '../shared/cluster-configuration';
import type { ClusterReply } from '../shared/cluster-configuration';
import {
  captureClusterRun,
  captureClusterDraft,
} from '../../../../packages/core/src/cluster/run-plan';
import type {
  ClusterDraft,
  SavedClusterConfiguration,
  GpuRun,
  CapturedClusterLoad,
} from '../../../../packages/core/src/cluster/contracts';
import type { StockClusterReport } from '../../../../packages/core/src/cluster/stock-profile';
import type { ModelConfigurationRecord } from '../../../../packages/core/src/model-configuration/contracts';
import type { SpeculativeDefaults } from '../../../../packages/core/src/speculative-decoding/contracts';
import type { SpeculativeCompanion } from '../../../../packages/core/src/speculative-decoding/assets';
interface Host {
  peers?(caller: string, input: unknown): Promise<PeerReply>;
  command(text: string, retainClusterDrafts?: boolean): Promise<Record<string, unknown>>;
  close(): Promise<void>;
  chat?(caller: string, input: unknown): Promise<ChatReply>;
  configuration?(caller: string, input: unknown): Promise<ConfigurationReply>;
  cluster?(caller: string, input: unknown): Promise<ClusterReply>;
  api?(caller: string, input: unknown): Promise<ApiOwnerReply>;
  changed?(listener: () => void): () => void;
  runtimePackage?(): RuntimePackageDescription | null;
  /** Trusted main prepares a verified engine only after model/resource admission. */
  prepare?(file: string): Promise<void>;
  prepareCluster?(
    file: string,
    saved: SavedClusterConfiguration,
    report: StockClusterReport,
    allowSharedMemory: boolean,
    confirmMemory?: () => Promise<boolean>,
  ): Promise<void>;
}
/** Trusted main dependencies; none of these capabilities are renderer inputs. */
interface ActivationDependencies {
  enabled: true;
  loadingStatus?: ModelLoadingStatus;
  peers?(input: unknown): Promise<PeerReply>;
  updatePeerHardware?(hardware: PeerHardware): Promise<void>;
  subscribePeers?(listener: (reply: PeerReply) => void): () => void;
  closePeers?(): Promise<void>;
  beginPeerQuit?(): Promise<void>;
  expectedHash: string;
  packageId: string;
  clusterArtifact?: string;
  runtimeSelection?(): Promise<RuntimePackageDescription>;
  runtimeInventory?(): Promise<{
    selected: RuntimePackageDescription;
    installed: boolean;
    choices?: readonly { id: RuntimeBuildId; build: RuntimePackageDescription }[];
  }>;
  selectRuntime?(build: RuntimeBuildId): Promise<RuntimePackageDescription>;
  activateRuntime?(): Promise<RuntimePackageDescription | null>;
  planCluster?(
    file: string,
    draft: ClusterDraft,
    blockCount: number,
    signal: AbortSignal,
    devices?: readonly string[],
    companion?: SpeculativeCompanion,
  ): Promise<readonly GpuRun[]>;
  preflightCluster?(
    file: string,
    saved: SavedClusterConfiguration,
    signal: AbortSignal,
    allowSharedMemory?: boolean,
    companion?: SpeculativeCompanion,
  ): Promise<StockClusterReport>;
  deploymentId?: string;
  pick(): Promise<string | null>;
  inspect(
    file: string,
  ): Promise<
    { sha256: string; size: string } & Partial<Omit<ModelSource, 'modelId' | 'file' | 'size'>>
  >;
  available?(source: ModelSource): Promise<boolean>;
  /** Trusted sealed header reconciliation; no model payload hashing or loading at startup. */
  reinspect?(source: ModelSource): Promise<ModelSource | null>;
  preflight(allowSharedMemory?: boolean): Promise<void>;
  /** Trusted main UI only; no renderer-supplied consent flag or launch argument. */
  confirmSharedMemory?(): Promise<boolean>;
  createHost(file: string): Promise<Host>;
  /** Model-independent utility/history startup; retains the same owner across model loads. */
  createHistoryHost?(source?: ModelSource, resumeClusterDrafts?: boolean): Promise<Host>;
  planModel?(
    file: string,
    record: ModelConfigurationRecord,
    signal: AbortSignal,
    companion?: SpeculativeCompanion,
  ): Promise<SavedClusterConfiguration>;
  device?(): Promise<RuntimeDevice>;
}
export type RuntimeDependencies =
  | ActivationDependencies
  | {
      enabled: false;
      device?(): Promise<RuntimeDevice>;
    };
const messages: Record<string, string> = {
  INSUFFICIENT_DISK_SPACE:
    'Not enough disk space to install the runtime. Free space on the runtime drive and try again.',
  GPU_BUSY:
    'A selected GPU is already in use by another ModelLoom workload. Stop it before loading.',
  RPC_PACKAGE_REQUIRED:
    'A verified peer runtime is required on both PCs before using a remote GPU.',
  INCOMPATIBLE_RUNTIME:
    'Both PCs must use the same compatible stock RPC runtime. Update the peer runtime and reconnect.',
  PEER_UNAVAILABLE: 'The other PC disconnected. Check its connection and sharing, then try again.',
  PEER_NOT_APPROVED: 'Verify and approve this app identity on both PCs before using its GPU.',
  GPU_NOT_SHARED: 'The selected GPU is no longer shared. Select a currently shared GPU.',
  UNSUPPORTED_PEER_GPU: 'Share one GPU on this PC for the current peer runtime.',
  INSUFFICIENT_RESOURCES:
    'Not enough available RAM or GPU memory for the selected settings. Free memory and try again.',
  INCOMPATIBLE_DRIVER: 'The GPU driver is incompatible with this runtime.',
  NEEDS_RESOURCE_EVIDENCE:
    'This configuration could not be verified for the selected runtime and GPUs.',
  NEEDS_SPECULATIVE_EVIDENCE:
    'The selected runtime needs the verified speculative estimator before this configuration can load.',
  INCOMPATIBLE_SPECULATIVE_ASSET:
    'This companion is not compatible with the selected target model. Choose a matching companion.',
  UNSUPPORTED_SPECULATIVE_DEVICE:
    'This speculative head shares target weights and must follow the target output placement. Choose Automatic, or use a standalone draft model for independent placement.',
  UNSUPPORTED_SPECULATIVE_RETRIEVAL:
    'This native retrieval method retains unbounded cross-request state. Choose n-gram simple or n-gram mod.',
  SPECULATIVE_INITIALIZATION_FAILED:
    'The runtime did not initialize the requested speculative method. The model was stopped instead of falling back.',
  UNSAVED_CONFIGURATION: 'The allocation changed. Run the current allocation again.',
  INVALID_CLUSTER_CONFIGURATION:
    'Assign all model layers exactly once, without gaps or overlaps, before running.',
  STALE_CONFIGURATION: 'The configuration changed. Select it again before running.',
  UNKNOWN_CONFIGURATION: 'The saved configuration could not be found.',
  SHARED_GPU_MEMORY_CONFIRMATION:
    'This configuration may use system RAM as shared GPU memory. Load again to review the warning.',
  PACKAGE_VERIFICATION_FAILED:
    'Runtime verification failed. Check the signed development package and its expiry.',
  UNSUPPORTED_MODEL: 'This GGUF is not compatible with the selected runtime.',
  INVALID_MODEL_ID: 'Select the imported model.',
  REMOVE_ACTIVE_MODEL: 'Stop this model in Cluster before removing its entry.',
  LIBRARY_REMOVE_FAILED: 'The model entry could not be removed. Try again.',
  BUSY: 'Stop the current model before importing or loading another model.',
  CLEANUP_FAILED: 'Owned runtime exit could not be confirmed. Loading is blocked.',
  CONFIGURATION_UNAVAILABLE:
    'Saved model settings could not be confirmed. Reopen configuration and try again.',
  MODEL_FILE_UNAVAILABLE:
    'This model file could not be safely opened. Choose a standalone copy of the GGUF, not a hard link or shortcut, and try again.',
  LIBRARY_UNAVAILABLE:
    'The saved model library could not be opened. Restart the app and try again.',
  CORE_START_TIMEOUT: 'The library service did not start in time. Restart the app and try again.',
  INVALID_GGUF: 'This file could not be indexed as a supported GGUF model.',
};
/** Saved library and session-only loading bridge. Fresh verification precedes each load.
 * Quit closes admission immediately and waits for in-flight preparation and owned exit.
 * Returned data never contains paths, native handles, ports or raw exception text.
 */
export function createRuntimeController(deps: RuntimeDependencies, caller: string = randomUUID()) {
  let view: RuntimeView = { enabled: deps.enabled, model: null, phase: 'stopped', error: null };
  // Prepare display metadata at startup without checking installed binaries or sampling hardware.
  let runtimeSelection = deps.enabled ? deps.runtimeSelection?.().catch(() => null) : undefined;
  let file: string | null = null,
    host: Host | undefined;
  let id = 0,
    epoch = 0,
    quitting = false,
    importing = false;
  let preparation: Promise<Host> | undefined;
  let enginePreparation: Promise<void> | undefined;
  let restoration: Promise<void> | undefined;
  let importPreparation: Promise<void> | undefined;
  let removalPreparation: Promise<void> | undefined;
  let historyFailed = false;
  const sources = new Map<string, ModelSource>();
  const companionFor = (settings?: SpeculativeDefaults): SpeculativeCompanion | undefined => {
    const source = settings?.enabled ? settings.proposer?.source : undefined;
    if (!source || source.kind !== 'asset') return undefined;
    const companion = sources.get(`model-${source.modelId}`);
    if (!companion || view.models?.find((m) => m.id === `model-${source.modelId}`)?.unavailable)
      throw Error('MODEL_FILE_UNAVAILABLE');
    return Object.freeze({
      modelId: companion.modelId,
      file: companion.file,
      sizeBytes: companion.sizeBytes,
      modifiedMs: companion.modifiedMs,
    });
  };
  function updateModel(model: RuntimeModel): void {
    const models = view.models ?? [];
    view = {
      ...view,
      model: view.model?.id === model.id ? model : view.model,
      models: models.some((entry) => entry.id === model.id)
        ? models.map((entry) => (entry.id === model.id ? model : entry))
        : [...models, model],
    };
  }
  async function restoreLibrary(): Promise<void> {
    if (!host?.api) return;
    let after: string | null = null;
    const models: RuntimeModel[] = [];
    const restored = new Map<string, ModelSource>();
    while (!quitting) {
      const command = { action: 'readLibraryEntry' as const, after };
      const reply = decodeApiOwnerReply(await host.api(caller, command), command);
      if (!reply.ok || !('entry' in reply)) throw Error('LIBRARY_UNAVAILABLE');
      if (!reply.entry) break;
      let { source } = reply.entry;
      const { lastUsedAt } = reply.entry;
      let unavailable = deps.enabled && deps.available ? !(await deps.available(source)) : true;
      if (
        !unavailable &&
        deps.enabled &&
        deps.reinspect &&
        (source.classificationVersion !== 1 || source.nextnPredictLayers === undefined)
      ) {
        const corrected = await deps.reinspect(source).catch(() => null);
        if (!corrected) unavailable = true;
        else {
          const updated = decodeModelSource(corrected);
          if (updated.modelId !== source.modelId || updated.classificationVersion !== 1)
            throw Error('LIBRARY_UNAVAILABLE');
          const command = {
            action: 'reinspectImport' as const,
            modelId: updated.modelId,
            source: updated,
          };
          const repaired = decodeApiOwnerReply(await host.api(caller, command), command);
          if (!repaired.ok || !('registered' in repaired)) throw Error('LIBRARY_UNAVAILABLE');
          source = updated;
        }
      }
      const model = modelView(source, unavailable);
      if (lastUsedAt !== null) model.lastUsedAt = lastUsedAt;
      models.push(model);
      restored.set(model.id, source);
      after = source.modelId;
    }
    if (quitting) return;
    sources.clear();
    for (const [key, source] of restored) sources.set(key, source);
    view = { ...view, models };
  }
  let hostModelId = deps.enabled ? deps.expectedHash : '';
  const currentModelId = () =>
    view.model?.id.replace(/^model-/u, '') ?? (deps.enabled ? deps.expectedHash : '');
  let memoryDecision: { id: string; resolve(answer: boolean): void } | undefined;
  let declinedMemoryOperation: number | undefined;
  const confirmMemory = (): Promise<boolean> => {
    if (deps.enabled && deps.confirmSharedMemory) return deps.confirmSharedMemory();
    if (memoryDecision || quitting) return Promise.resolve(false);
    const warningId = randomUUID();
    view = { ...view, memoryWarning: { id: warningId } };
    return new Promise((resolve) => {
      memoryDecision = {
        id: warningId,
        resolve(answer) {
          memoryDecision = undefined;
          view = { ...view, memoryWarning: null };
          resolve(answer);
        },
      };
    });
  };
  const confirmForLoad = (operation: number, signal: AbortSignal) => async () => {
    if (operation !== epoch || quitting || signal.aborted) return false;
    const confirmed = await confirmMemory();
    if (!confirmed && operation === epoch && !quitting && !signal.aborted)
      declinedMemoryOperation = operation;
    return confirmed && operation === epoch && !quitting && !signal.aborted;
  };
  let deviceProbe: Promise<void> | undefined;
  let deviceObservedAt = 0;
  let deviceCleanupFailed = false;
  let deviceGeneration = 0;
  let unsubscribe: (() => void) | undefined;
  let usageProbe: Promise<void> | undefined;
  let planning: AbortController | undefined, clusterLoading: AbortController | undefined;
  let pendingCluster: RuntimeView['activeCluster'] = null;
  let selectedPeerRuns: readonly { uuid: string }[] = [];
  let ownedPeerRuns: readonly { uuid: string }[] = [];
  let planningPeerRuns: readonly { uuid: string }[] = [];
  let peerInterruption: Promise<void> | undefined;
  let clusterCleanupFailed = false;
  let runningConfiguration = false;
  const clusterOperations = new Set<Promise<unknown>>();
  let clusterTail: Promise<void> = Promise.resolve();
  async function trackCluster<T>(work: () => Promise<T>, signal: AbortSignal): Promise<T> {
    const operation = clusterTail.then(() => {
      if (clusterCleanupFailed) throw Error('CLEANUP_FAILED');
      if (signal.aborted || quitting) throw Error('PLANNING_CANCELLED');
      return work();
    });
    clusterTail = operation.then(
      () => undefined,
      (error: unknown) => {
        if (error instanceof Error && error.message === 'CLEANUP_FAILED')
          clusterCleanupFailed = true;
      },
    );
    clusterOperations.add(operation);
    try {
      return await operation;
    } catch (error) {
      if (error instanceof Error && error.message === 'CLEANUP_FAILED') clusterCleanupFailed = true;
      throw error;
    } finally {
      clusterOperations.delete(operation);
    }
  }
  const chatListeners = new Set<() => void>();
  const observeChat = (created: Host) => {
    if (!quitting)
      unsubscribe = created.changed?.(() => {
        for (const listener of chatListeners) listener();
      });
    return created;
  };
  let historySelection = Promise.resolve();
  async function selectHistoryOwner(source: ModelSource, idleOnly = false): Promise<void> {
    const selection = historySelection.then(() => replaceHistoryOwner(source, idleOnly));
    historySelection = selection.catch(() => undefined);
    return selection;
  }
  async function replaceHistoryOwner(source: ModelSource, idleOnly: boolean): Promise<void> {
    if (!deps.enabled || !deps.createHistoryHost || (host && hostModelId === source.modelId))
      return;
    if (quitting) return;
    if (
      idleOnly &&
      (importing ||
        runningConfiguration ||
        planning ||
        clusterLoading ||
        clusterCleanupFailed ||
        !['stopped', 'failed'].includes(view.phase))
    )
      throw Error('NOT_READY');
    if (host) {
      unsubscribe?.();
      await host.command(JSON.stringify({ id: ++id, action: 'quit' }));
      await host.close();
      host = undefined;
      preparation = undefined;
    }
    if (quitting) return;
    const creating = deps.createHistoryHost(source);
    preparation = creating;
    try {
      host = observeChat(await creating);
    } catch (error) {
      if (preparation === creating) preparation = undefined;
      throw error;
    }
    hostModelId = source.modelId;
  }
  function applyRuntimeSelection() {
    if (!deps.enabled || !deps.activateRuntime) return Promise.resolve();
    const selection = historySelection.then(replaceRuntimeOwner);
    historySelection = selection.catch(() => undefined);
    return selection;
  }
  async function replaceRuntimeOwner() {
    if (!deps.enabled || !deps.activateRuntime) return;
    const selected = await deps.runtimeSelection?.();
    if (
      !selected ||
      (selected.packageId === deps.packageId && selected.artifact === deps.clusterArtifact)
    )
      return;
    if (
      view.restoring ||
      importing ||
      runningConfiguration ||
      planning ||
      clusterLoading ||
      clusterCleanupFailed ||
      !['stopped', 'failed'].includes(view.phase)
    )
      throw Error('BUSY');
    if (preparation) await preparation;
    if (enginePreparation) await enginePreparation.catch(() => undefined);
    if (quitting) return;
    const previousHost = host;
    // The model picker may already have bound a draft to a different owner than the last loaded model.
    const source =
      sources.get(`model-${hostModelId}`) ?? (view.model && sources.get(view.model.id));
    const activated = await deps.activateRuntime();
    if (!activated || quitting) return;
    if (host) {
      unsubscribe?.();
      await host.command(JSON.stringify({ id: ++id, action: 'quit' }), true);
      await host.close();
      host = undefined;
      preparation = undefined;
      hostModelId = '';
      enginePreparation = undefined;
    }
    deps.packageId = activated.packageId;
    deps.clusterArtifact = activated.artifact;
    if (!quitting && deps.createHistoryHost) {
      const creating = deps.createHistoryHost(source ?? undefined, previousHost !== undefined);
      preparation = creating;
      try {
        host = observeChat(await creating);
        hostModelId = source?.modelId ?? '';
      } catch (error) {
        if (preparation === creating) preparation = undefined;
        throw error;
      }
    }
  }
  if (deps.enabled && deps.createHistoryHost) {
    view = { ...view, restoring: true, models: [] };
    preparation = Promise.resolve()
      .then(() => deps.createHistoryHost!())
      .then((created) => {
        host = observeChat(created);
        return created;
      });
    void preparation.catch(() => {
      historyFailed = true;
    });
    restoration = preparation
      .then(async () => {
        if (quitting || !host?.api) return;
        await restoreLibrary();
        const reply = await host.api(caller, { action: 'readImportSource' });
        if (!reply.ok || !('source' in reply)) throw new Error('LIBRARY_UNAVAILABLE');
        if (reply.source === null) return;
        const source = decodeModelSource(reply.source);
        await selectHistoryOwner(source);
        if (quitting) return;
        file = source.file;
        const model = view.models?.find((entry) => entry.id === `model-${source.modelId}`);
        if (!model) throw Error('LIBRARY_UNAVAILABLE');
        view = { ...view, model };
        await observeModelUse();
      })
      .catch((error: unknown) => {
        if (!quitting)
          view = {
            ...view,
            error:
              error instanceof Error && error.message === 'CORE_START_TIMEOUT'
                ? messages.CORE_START_TIMEOUT!
                : messages.LIBRARY_UNAVAILABLE!,
          };
      })
      .finally(() => {
        view = { ...view, restoring: false };
      });
  }
  function modelView(source: ModelSource, unavailable = false): RuntimeModel {
    return {
      id: `model-${source.modelId}`,
      name: source.name,
      filename: path.win32.basename(source.file),
      size: source.size,
      architecture: source.architecture,
      contextLimit: source.contextLimit,
      blockCount: source.blockCount ?? null,
      embeddedMtp: (source.nextnPredictLayers ?? 0) > 0,
      quantization: source.quantization,
      parameters: source.parameters,
      ...(source.speculativeHead ? { speculativeHead: source.speculativeHead } : {}),
      unavailable,
    };
  }
  async function observeModelUse(): Promise<void> {
    if (quitting || !host?.api || !view.model) return;
    if (usageProbe) return usageProbe;
    const operation = epoch;
    const modelId = view.model.id;
    const owner = host;
    const work = (async () => {
      const command = { action: 'readModelUsage' as const };
      const reply = decodeApiOwnerReply(await owner.api!(caller, command), command);
      if (!reply.ok || !('lastUsedAt' in reply)) return;
      if (quitting || operation !== epoch || view.model?.id !== modelId) return;
      const updated = { ...view.model };
      if (reply.lastUsedAt === null) delete updated.lastUsedAt;
      else updated.lastUsedAt = reply.lastUsedAt;
      updateModel(updated);
    })().catch(() => {
      console.error('Model last-use time could not be read.');
    });
    usageProbe = work;
    try {
      await work;
    } finally {
      if (usageProbe === work) usageProbe = undefined;
    }
  }
  const observeDevice = async () => {
    if (deviceCleanupFailed) throw new Error('QUERY_CLEANUP_FAILED');
    if (!deps.device || quitting || (view.device && Date.now() - deviceObservedAt < 2000)) return;
    const generation = deviceGeneration;
    deviceProbe ??= Promise.resolve()
      .then(() => (quitting ? undefined : deps.device!()))
      .then(async (device) => {
        if (!quitting && device && generation === deviceGeneration) {
          view = { ...view, device };
          deviceObservedAt = Date.now();
          if (deps.enabled && deps.updatePeerHardware)
            await deps.updatePeerHardware(toPeerHardware(device));
        }
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.message === 'QUERY_CLEANUP_FAILED') {
          deviceCleanupFailed = true;
          throw error;
        }
        // Hardware visibility is independent of model admission; retry a failed observation.
        if (generation === deviceGeneration) deviceObservedAt = Date.now();
      });
    const pending = deviceProbe;
    try {
      await pending;
    } finally {
      if (deviceProbe === pending) deviceProbe = undefined;
    }
    // A notification during the scan invalidates its result, without overlapping native queries.
    if (!quitting && generation !== deviceGeneration) await observeDevice();
  };
  const result = () =>
    structuredClone({
      ...view,
      activeRuntime: view.phase === 'ready' ? (host?.runtimePackage?.() ?? null) : null,
      loadingStage:
        deps.enabled && ['starting', 'loading'].includes(view.phase)
          ? deps.loadingStatus?.stage
          : undefined,
    });
  const send = async (
    action: string,
    selection?: Record<string, string>,
    clusterConfiguration?: { id: string; revision: number; load: CapturedClusterLoad },
    modelConfiguration?: SavedClusterConfiguration,
    clusterDraft?: { key: string; revision: number },
  ) => {
    if (!host) return;
    const reply = await host.command(
      JSON.stringify({
        id: ++id,
        action,
        ...(selection ? { selection } : {}),
        ...(clusterConfiguration ? { clusterConfiguration } : {}),
        ...(modelConfiguration ? { modelConfiguration } : {}),
        ...(clusterDraft ? { clusterDraft } : {}),
      }),
    );
    if (reply.error) throw new Error('START_FAILED');
    const snapshot = reply.snapshot;
    if (!snapshot || typeof snapshot !== 'object' || !('phase' in snapshot))
      throw new Error('INVALID_CONTROL');
    const phase = snapshot.phase;
    if (!['stopped', 'starting', 'loading', 'ready', 'stopping', 'failed'].includes(String(phase)))
      throw new Error('INVALID_CONTROL');
    if (action === 'load' && phase === 'ready') ownedPeerRuns = selectedPeerRuns;
    if (action === 'stop' || action === 'quit') ownedPeerRuns = [];
    // The host is trusted, but only this closed phase field crosses into renderer state.
    view = {
      ...view,
      phase: phase as RuntimeView['phase'],
      activeCluster: phase === 'ready' ? (pendingCluster ?? null) : null,
      error:
        phase === 'failed'
          ? 'Runtime stopped unexpectedly or failed to load. Stop and retry explicitly.'
          : null,
    };
    if (
      phase === 'failed' &&
      'fault' in snapshot &&
      snapshot.fault &&
      typeof snapshot.fault === 'object'
    ) {
      const fault = snapshot.fault as { code?: unknown; message?: unknown };
      if (fault.code === 'CLEANUP_FAILED') view.error = messages.CLEANUP_FAILED!;
      else if (fault.code === 'START_TIMEOUT')
        view.error = 'Model loading timed out. Stop and retry explicitly.';
      else if (fault.code === 'ENGINE_EXITED')
        view.error = 'The model runtime exited unexpectedly. Stop and retry explicitly.';
      else if (fault.code === 'START_FAILED') {
        // Only these closed reasons cross into UI text; never display native output.
        const reasons: Record<string, string> = {
          'Engine startup failed (RPC_DISCONNECTED)':
            'The connection to the remote GPU closed during loading.',
          'Engine startup failed (PLACEMENT_MISMATCH)':
            'The runtime layer allocation did not match the selected configuration.',
          'Engine startup failed (CONTEXT_MISMATCH)':
            'The runtime context did not match the selected configuration.',
        };
        if (typeof fault.message === 'string' && Object.hasOwn(reasons, fault.message))
          view.error = reasons[fault.message]! + ' Stop and retry explicitly.';
      }
    }
  };
  const peerListeners = new Set<() => void>();
  const unsubscribePeers = deps.enabled
    ? deps.subscribePeers?.((reply) => {
        if (quitting) return;
        for (const listener of peerListeners) listener();
        if (peerInterruption || (!reply?.ok && reply?.error !== 'CORE_EXITED')) return;
        const available = new Set(
          (reply.ok ? reply.view.outgoing : [])
            .filter(
              (peer) => peer.phase === 'approved' && peer.localVerified && peer.remoteVerified,
            )
            .flatMap((peer) => peer.gpus.map((gpu) => `peer:${peer.peerFingerprint}:${gpu.id}`)),
        );
        const runs = [
          ...selectedPeerRuns,
          ...ownedPeerRuns,
          ...planningPeerRuns,
          ...(pendingCluster?.runs ?? []),
          ...(view.activeCluster?.runs ?? []),
        ];
        if (!runs.some((run) => run.uuid.startsWith('peer:') && !available.has(run.uuid))) return;
        clusterLoading?.abort();
        planning?.abort();
        memoryDecision?.resolve(false);
        ++epoch;
        pendingCluster = null;
        selectedPeerRuns = [];
        ownedPeerRuns = [];
        planningPeerRuns = [];
        view = { ...view, phase: 'failed', activeCluster: null, error: messages.PEER_UNAVAILABLE! };
        peerInterruption = (async () => {
          try {
            // An in-flight prepare may still own native resources; settle it before stopping its owner.
            await enginePreparation?.catch(() => undefined);
            if (host) await send('stop');
            if (!quitting)
              view = {
                ...view,
                phase: 'failed',
                activeCluster: null,
                error: messages.PEER_UNAVAILABLE!,
              };
          } catch {
            clusterCleanupFailed = true;
            if (!quitting)
              view = {
                ...view,
                phase: 'failed',
                activeCluster: null,
                error: messages.CLEANUP_FAILED!,
              };
          } finally {
            peerInterruption = undefined;
            for (const listener of peerListeners) listener();
          }
        })();
      })
    : undefined;
  return {
    subscribePeers(listener: () => void): () => void {
      peerListeners.add(listener);
      return () => peerListeners.delete(listener);
    },
    async peers(input: unknown): Promise<PeerReply> {
      const command = decodePeerCommand(input);
      if (quitting || !deps.enabled) return { ok: false, error: 'NOT_READY' };
      try {
        if (preparation) await preparation;
        if (quitting) return { ok: false, error: 'NOT_READY' };
        if (command.action === 'disconnect') {
          const rawPeers = deps.peers
            ? await deps.peers({ action: 'read' })
            : await host?.peers?.(caller, { action: 'read' });
          const peers = rawPeers ? decodePeerReply(rawPeers) : undefined;
          if (!peers?.ok) return { ok: false, error: 'PEER_UNAVAILABLE' };
          const peer = peers.view.outgoing.find((value) => value.id === command.id);
          if (!peer) return { ok: false, error: 'UNKNOWN_PEER_REQUEST' };
          const prefix = `peer:${peer.peerFingerprint}:`;
          const inUse = [
            ...selectedPeerRuns,
            ...ownedPeerRuns,
            ...planningPeerRuns,
            ...(pendingCluster?.runs ?? []),
            ...(view.activeCluster?.runs ?? []),
          ].some((run) => run.uuid.startsWith(prefix));
          if (inUse && !command.stopModel) return { ok: false, error: 'PEER_IN_USE' };
          if (inUse) {
            const stopped = await this.command({ action: 'stop' });
            await enginePreparation?.catch(() => undefined);
            await clusterTail;
            if (stopped.phase !== 'stopped' || clusterCleanupFailed)
              return { ok: false, error: 'CLEANUP_FAILED' };
          }
        }
        if (deps.enabled && deps.peers) return decodePeerReply(await deps.peers(command));
        if (!host?.peers) return { ok: false, error: 'NOT_READY' };
        return decodePeerReply(await host.peers(caller, command));
      } catch {
        return { ok: false, error: 'PEER_UNAVAILABLE' };
      }
    },
    async cluster(input: unknown): Promise<ClusterReply> {
      const command = decodeClusterCommand(input);
      if (
        ['edit', 'discard', 'save', 'delete', 'cancel-planning', 'auto-place'].includes(
          command.action,
        )
      )
        planning?.abort();
      if (quitting || !deps.enabled) return { ok: false, error: 'NOT_READY' };
      if (
        command.action === 'delete' &&
        (runningConfiguration || ['starting', 'loading', 'stopping'].includes(view.phase))
      )
        return { ok: false, error: 'NOT_READY' };
      try {
        if (preparation) await preparation;
        if (restoration) await restoration;
        if (quitting || !host?.cluster) return { ok: false, error: 'NOT_READY' };
        const requestedModelId =
          'modelId' in command
            ? command.modelId
            : command.action === 'edit'
              ? command.edit.modelId
              : 'key' in command && command.key.startsWith('model:')
                ? command.key.slice(6)
                : undefined;
        if (requestedModelId && sources.get(`model-${requestedModelId}`)?.speculativeHead)
          return { ok: false, error: 'UNKNOWN_MODEL' };
        // Run must acknowledge the draft on the model's eventual owner. Switching
        // owners afterwards clears session drafts during the old owner's close.
        if (
          command.action === 'read' &&
          !importing &&
          !runningConfiguration &&
          !planning &&
          !clusterLoading &&
          !clusterCleanupFailed &&
          ['stopped', 'failed'].includes(view.phase)
        ) {
          const source = sources.get(`model-${command.modelId}`);
          if (source) await selectHistoryOwner(source, true);
          if (quitting || !host?.cluster) return { ok: false, error: 'NOT_READY' };
        }
        // Legacy indexes are re-inspected only when opening placement, not on every startup.
        if (
          command.action === 'read' &&
          view.model?.blockCount == null &&
          file &&
          command.modelId === currentModelId() &&
          host.api
        ) {
          const info = await deps.inspect(file);
          if (quitting || info.sha256 !== currentModelId())
            return { ok: false, error: 'UNKNOWN_MODEL' };
          const previous = sources.get(`model-${currentModelId()}`);
          if (previous) {
            const source = decodeModelSource({
              ...previous,
              blockCount: info.blockCount ?? null,
            });
            const registered = await host.api(caller, {
              action: 'registerImport',
              modelId: source.modelId,
              created: Math.floor(Date.now() / 1000),
              source,
            });
            if (!registered.ok) return { ok: false, error: 'CONFIGURATION_UNAVAILABLE' };
            sources.set(`model-${source.modelId}`, source);
            const model = modelView(source);
            updateModel(model);
          }
        }
        if (command.action === 'auto-place') {
          if (runningConfiguration || ['starting', 'loading', 'stopping'].includes(view.phase))
            throw Error('NOT_READY');
          if (clusterCleanupFailed) throw Error('CLEANUP_FAILED');
          if (!deps.planCluster) throw Error('NEEDS_MODEL_METADATA');
          const operation = new AbortController();
          planning = operation;
          const configurationId = command.key.startsWith('config:') ? command.key.slice(7) : null;
          let modelId = command.key.slice(6);
          if (configurationId) {
            const listed = decodeClusterReply(await host.cluster(caller, { action: 'list' }));
            if (!listed.ok) return listed;
            const configuration = listed.configurations.find(
              (entry) => entry.id === configurationId,
            );
            if (!configuration) throw Error('UNKNOWN_CONFIGURATION');
            modelId = configuration.modelId;
          }
          if (!sources.has(`model-${modelId}`) || sources.get(`model-${modelId}`)?.speculativeHead)
            throw Error('UNKNOWN_MODEL');
          const read = decodeClusterReply(
            await host.cluster(caller, {
              action: 'read',
              modelId,
              configurationId,
            }),
          );
          if (!read.ok) return read;
          const source = read.draft ? sources.get(`model-${read.draft.modelId}`) : undefined;
          if (source?.speculativeHead) throw Error('UNKNOWN_MODEL');
          if (!source?.blockCount) throw Error('NEEDS_MODEL_METADATA');
          if (
            !read.draft ||
            read.draft.key !== command.key ||
            read.draft.revision !== command.revision
          )
            throw Error('STALE_CONFIGURATION');
          if (operation.signal.aborted || quitting) throw Error('PLANNING_CANCELLED');
          const selectedFile = source.file,
            currentDraft = read.draft,
            blocks = source.blockCount;
          const eligible = command.devices;
          planningPeerRuns = currentDraft.runs;
          const runs = await trackCluster(
            () =>
              eligible
                ? deps.planCluster!(
                    selectedFile,
                    currentDraft,
                    blocks,
                    operation.signal,
                    eligible,
                    companionFor(currentDraft.load.speculation),
                  )
                : deps.planCluster!(
                    selectedFile,
                    currentDraft,
                    blocks,
                    operation.signal,
                    undefined,
                    companionFor(currentDraft.load.speculation),
                  ),
            operation.signal,
          );
          if (operation.signal.aborted || quitting) throw Error('PLANNING_CANCELLED');
          if (eligible && runs.some((run) => !eligible.includes(run.uuid)))
            throw Error('INVALID_CONTROL');
          const reply = await host.cluster(caller, {
            action: 'edit',
            key: command.key,
            expectedRevision: command.revision,
            edit: {
              modelId: read.draft.modelId,
              load: read.draft.load,
              ...(read.draft.canvas ? { canvas: read.draft.canvas } : {}),
              ...(read.draft.proposerDevice ? { proposerDevice: read.draft.proposerDevice } : {}),
              runs: runs.map((r) => ({
                uuid: r.uuid,
                first: String(r.first),
                last: String(r.last),
              })),
            },
          });
          if (planning === operation) planning = undefined;
          planningPeerRuns = [];
          return decodeClusterReply(reply);
        }
        return decodeClusterReply(await host.cluster(caller, command));
      } catch (error) {
        if (command.action === 'auto-place') planningPeerRuns = [];
        try {
          return decodeClusterReply({
            ok: false,
            error: error instanceof Error ? error.message : '',
          });
        } catch {
          /* Closed error vocabulary only. */
        }
        return { ok: false, error: 'CONFIGURATION_UNAVAILABLE' };
      }
    },
    /** Trusted native device-change notification; bypasses the telemetry cache, never admission. */
    async deviceChanged(): Promise<void> {
      if (quitting) return;
      ++deviceGeneration;
      deviceObservedAt = Number.NEGATIVE_INFINITY;
      await observeDevice();
    },
    async api(input: unknown): Promise<ApiManagementReply> {
      const command = decodeApiManagementCommand(input);
      if (quitting || !deps.enabled) return { ok: false, error: 'NOT_READY' };
      try {
        if (preparation) await preparation;
        if (quitting || !host?.api) return { ok: false, error: 'API_UNAVAILABLE' };
        return decodeApiManagementReply(
          await host.api(caller, command),
          command.action === 'copyKey' || command.action === 'revealKey',
        );
      } catch {
        return { ok: false, error: 'API_UNAVAILABLE' };
      }
    },
    async configuration(input: unknown): Promise<ConfigurationReply> {
      const command = decodeConfigurationCommand(input);
      if (quitting || !deps.enabled || !file || !view.model)
        return { ok: false, error: 'NOT_READY' };
      const source = sources.get(`model-${command.modelId}`);
      if (!source || source.speculativeHead) return { ok: false, error: 'UNKNOWN_MODEL' };
      try {
        if (preparation) await preparation;
        if (quitting || !host?.configuration)
          return { ok: false, error: 'CONFIGURATION_UNAVAILABLE' };
        return decodeConfigurationReply(await host.configuration(caller, command));
      } catch {
        return { ok: false, error: 'CONFIGURATION_UNAVAILABLE' };
      }
    },
    async chat(input: unknown): Promise<ChatReply> {
      const command = decodeChatCommand(input);
      if (quitting || !deps.enabled) return { ok: false, error: 'NOT_READY' };
      try {
        if (deps.createHistoryHost && preparation) await preparation;
        if (quitting) return { ok: false, error: 'NOT_READY' };
        if (!host?.chat)
          return { ok: false, error: historyFailed ? 'HISTORY_UNAVAILABLE' : 'NOT_READY' };
        if (['send', 'retry'].includes(command.action) && view.phase !== 'ready')
          return { ok: false, error: 'NOT_READY' };
        return await host.chat(caller, command);
      } catch {
        return { ok: false, error: 'HISTORY_UNAVAILABLE' };
      }
    },
    subscribeChat(listener: () => void): () => void {
      chatListeners.add(listener);
      return () => chatListeners.delete(listener);
    },
    async command(input: unknown): Promise<RuntimeView> {
      const command = decodeRuntimeCommand(input);
      if (quitting) return result();
      if (command.action === 'select-runtime') {
        if (!deps.enabled || !deps.selectRuntime) throw Error('NOT_READY');
        const selected = await deps.selectRuntime(command.build);
        runtimeSelection = Promise.resolve(selected);
        if (
          !view.restoring &&
          !importing &&
          !planning &&
          !clusterLoading &&
          ['stopped', 'failed'].includes(view.phase)
        ) {
          try {
            await applyRuntimeSelection();
          } catch (error) {
            // A remote model can still own this PC's GPUs; retain its package until it stops.
            if (!(error instanceof Error && error.message === 'GPU_BUSY')) throw error;
          }
        }
        return {
          ...result(),
          selectedRuntime: selected,
          runtimeInventory: deps.runtimeInventory
            ? { status: 'ready', ...(await deps.runtimeInventory()) }
            : { status: 'unavailable' },
        };
      }
      if (command.action === 'runtime-selection') {
        const selectedRuntime = (await runtimeSelection) ?? null;
        return { ...result(), selectedRuntime };
      }
      if (command.action === 'runtime-inventory') {
        let inventory: RuntimeInventory = { status: 'unavailable' };
        if (deps.enabled && deps.runtimeInventory) {
          try {
            inventory = { status: 'ready', ...(await deps.runtimeInventory()) };
          } catch {
            inventory = { status: 'error' };
          }
        }
        return { ...result(), runtimeInventory: inventory };
      }
      if (command.action === 'memory-decision') {
        if (memoryDecision?.id === command.id) memoryDecision.resolve(command.loadAnyway);
        return result();
      }
      if (command.action === 'stop' || command.action === 'import') memoryDecision?.resolve(false);
      if (command.action === 'snapshot' && (importing || view.restoring)) return result();
      if (command.action === 'snapshot') await observeDevice();
      if (!deps.enabled || quitting) return result();
      let loadingEpoch: number | undefined;
      let ownedClusterLoad: AbortController | undefined;
      let ownsConfigurationRun = false;
      try {
        if (command.action === 'snapshot') {
          // Keep a rejected admission visible until an explicit stop/retry. A stopped core
          // has no knowledge of main's preflight failure and must not erase that evidence.
          // Poll only between owner replacements, never while the previous owner shuts down.
          const reading = historySelection.then(async () => {
            if (quitting) return;
            if (host && view.phase !== 'failed') await send('snapshot');
            await observeModelUse();
          });
          historySelection = reading.catch(() => undefined);
          await reading;
        } else if (command.action === 'remove') {
          if (
            importing ||
            view.restoring ||
            runningConfiguration ||
            clusterOperations.size ||
            !['stopped', 'failed', 'ready'].includes(view.phase)
          )
            throw Error('BUSY');
          if (!sources.has(command.modelId)) throw Error('INVALID_MODEL_ID');
          if (view.phase === 'ready' && view.model?.id === command.modelId)
            throw Error('REMOVE_ACTIVE_MODEL');
          importing = true;
          const work = (async () => {
            if (preparation) await preparation;
            if (quitting || !host?.api) throw Error('LIBRARY_REMOVE_FAILED');
            const request = { action: 'removeImport' as const, modelId: command.modelId.slice(6) };
            const reply = decodeApiOwnerReply(await host.api(caller, request), request);
            if (!reply.ok || !('removed' in reply)) throw Error('LIBRARY_REMOVE_FAILED');
            sources.delete(command.modelId);
            const selected = view.model?.id === command.modelId;
            if (selected) file = null;
            view = {
              ...view,
              model: selected ? null : view.model,
              models: (view.models ?? []).filter((model) => model.id !== command.modelId),
              error: null,
            };
          })();
          removalPreparation = work;
          try {
            await work;
          } finally {
            importing = false;
            removalPreparation = undefined;
          }
        } else if (command.action === 'import') {
          if (importing || runningConfiguration || !['stopped', 'failed'].includes(view.phase))
            throw new Error('BUSY');
          importing = true;
          ++epoch;
          const work = (async () => {
            if (restoration) await restoration;
            if (quitting) return;
            const selected = await deps.pick();
            if (selected === null || quitting) return result();
            view = { ...view, indexing: path.win32.basename(selected), error: null };
            const info = await deps.inspect(selected).catch((error: unknown) => {
              if (error instanceof Error && error.message === 'OWNERSHIP_FAILED')
                throw new Error('MODEL_FILE_UNAVAILABLE');
              throw error;
            });
            const importedAt = Math.floor(Date.now() / 1000);
            if (!/^[a-f0-9]{64}$/u.test(info.sha256)) throw Error('UNSUPPORTED_MODEL');
            if (quitting) return result();
            const source: ModelSource = {
              modelId: info.sha256,
              file: path.resolve(selected),
              name: info.name ?? path.win32.basename(selected),
              size: info.size,
              sizeBytes: info.sizeBytes ?? 0,
              modifiedMs: info.modifiedMs ?? 0,
              architecture: info.architecture ?? 'Unknown',
              contextLimit: info.contextLimit ?? 0,
              blockCount: info.blockCount ?? null,
              quantization: info.quantization ?? 'Unknown',
              parameters: info.parameters ?? 'Unknown',
              ...(info.thinkingSupported === undefined
                ? {}
                : { thinkingSupported: info.thinkingSupported }),
              ...(info.speculativeHead ? { speculativeHead: info.speculativeHead } : {}),
              classificationVersion: 1,
              nextnPredictLayers: info.nextnPredictLayers ?? 0,
            };
            if (source.speculativeHead) {
              if (preparation) await preparation;
              if (quitting) return;
              if (!host?.api) throw new Error('LIBRARY_UNAVAILABLE');
              const command = {
                action: 'registerCompanion' as const,
                modelId: source.modelId,
                created: importedAt,
                source,
              };
              const registered = decodeApiOwnerReply(await host.api(caller, command), command);
              if (!registered.ok || !('registered' in registered))
                throw new Error('LIBRARY_UNAVAILABLE');
              if (quitting) return;
              const model = modelView(source);
              sources.set(model.id, source);
              updateModel(model);
              view = { ...view, error: null };
              return;
            }
            if (deps.createHistoryHost && preparation) await preparation;
            await observeDevice();
            if (host && deps.createHistoryHost) {
              await send('stop');
            } else if (host) {
              unsubscribe?.();
              await send('quit');
              await host.close();
              host = undefined;
            }
            await selectHistoryOwner(source);
            if (host?.api) {
              const registered = await host.api(caller, {
                action: 'registerImport',
                modelId: info.sha256,
                created: importedAt,
                source,
              });
              if (!registered.ok || !('registered' in registered))
                throw new Error('CONFIGURATION_UNAVAILABLE');
            }
            if (quitting) return;
            file = selected;
            const model = modelView(source);
            const previous = view.models?.find((entry) => entry.id === model.id);
            if (previous?.lastUsedAt !== undefined) model.lastUsedAt = previous.lastUsedAt;
            sources.set(model.id, source);
            updateModel(model);
            view = {
              ...view,
              model,
              phase: 'stopped',
              error: null,
            };
            await observeModelUse();
          })();
          importPreparation = work.then(() => undefined);
          try {
            await importPreparation;
          } finally {
            importPreparation = undefined;
            importing = false;
            view = { ...view, indexing: null };
          }
        } else if (command.action === 'run-configuration') {
          await applyRuntimeSelection();
          if (runningConfiguration || importing) throw Error('BUSY');
          runningConfiguration = true;
          ownsConfigurationRun = true;
          if (clusterCleanupFailed) throw Error('CLEANUP_FAILED');
          if (preparation) await preparation;
          if (quitting || !host?.cluster || !deps.clusterArtifact)
            throw Error('NEEDS_RESOURCE_EVIDENCE');
          let capturedEpoch = epoch;
          const listed = decodeClusterReply(await host.cluster(caller, { action: 'list' }));
          if (!listed.ok) throw Error(listed.error);
          const selected = listed.configurations.find((c) => c.id === command.configurationId);
          if (
            !selected ||
            !sources.has(`model-${selected.modelId}`) ||
            sources.get(`model-${selected.modelId}`)?.speculativeHead
          )
            throw Error('UNKNOWN_CONFIGURATION');
          if (selected.modelId !== currentModelId()) {
            if (importing || !['stopped', 'failed'].includes(view.phase)) throw Error('BUSY');
            const source = sources.get(`model-${selected.modelId}`)!;
            capturedEpoch = ++epoch;
            await selectHistoryOwner(source);
            if (quitting || epoch !== capturedEpoch) return result();
            file = source.file;
            view = {
              ...view,
              model: view.models!.find((entry) => entry.id === `model-${source.modelId}`)!,
              phase: 'stopped',
              error: null,
            };
          }
          const restored = decodeClusterReply(
            await host.cluster(caller, {
              action: 'read',
              modelId: selected.modelId,
              configurationId: selected.id,
            }),
          );
          if (quitting || epoch !== capturedEpoch) return result();
          if (!restored.ok) throw Error(restored.error);
          if (!restored.configuration) throw Error('UNKNOWN_CONFIGURATION');
          captureClusterRun(
            restored.configuration,
            command.revision,
            restored.draft,
            deps.clusterArtifact,
          );
          if (!file || view.model?.unavailable || !deps.preflightCluster || !host.prepareCluster)
            throw Error('NEEDS_RESOURCE_EVIDENCE');
          if (!['ready', 'stopped', 'failed'].includes(view.phase)) throw Error('BUSY');
          const abort = new AbortController();
          clusterLoading?.abort();
          clusterLoading = abort;
          ownedClusterLoad = abort;
          const saved = restored.configuration;
          selectedPeerRuns = saved.runs;
          let confirmed = false,
            budget: StockClusterReport;
          try {
            const selectedFile = file;
            budget = await trackCluster(
              () =>
                deps.preflightCluster!(
                  selectedFile,
                  saved,
                  abort.signal,
                  false,
                  companionFor(saved.load.speculation),
                ),
              abort.signal,
            );
          } catch (error) {
            if (!(error instanceof Error) || error.message !== 'SHARED_GPU_MEMORY_CONFIRMATION')
              throw error;
            if (abort.signal.aborted || quitting || epoch !== capturedEpoch) return result();
            confirmed = await confirmMemory();
            if (!confirmed) return result();
            if (abort.signal.aborted || quitting || epoch !== capturedEpoch) return result();
            const selectedFile = file;
            budget = await trackCluster(
              () =>
                deps.preflightCluster!(
                  selectedFile,
                  saved,
                  abort.signal,
                  true,
                  companionFor(saved.load.speculation),
                ),
              abort.signal,
            );
          }
          if (abort.signal.aborted || quitting || epoch !== capturedEpoch) return result();
          const latest = decodeClusterReply(
            await host.cluster(caller, {
              action: 'read',
              modelId: saved.modelId,
              configurationId: saved.id,
            }),
          );
          if (!latest.ok || !latest.configuration) throw Error('STALE_CONFIGURATION');
          captureClusterRun(
            latest.configuration,
            command.revision,
            latest.draft,
            deps.clusterArtifact,
          );
          if (!isDeepStrictEqual(latest.configuration.load, saved.load))
            throw Error('STALE_CONFIGURATION');
          if (abort.signal.aborted || quitting || epoch !== capturedEpoch) return result();
          if (clusterCleanupFailed) throw Error('CLEANUP_FAILED');
          const operation = ++epoch;
          loadingEpoch = operation;
          await send('stop');
          if (operation !== epoch || quitting) return result();
          deps.loadingStatus?.begin();
          view = { ...view, phase: 'starting', error: null };
          if (clusterCleanupFailed) throw Error('CLEANUP_FAILED');
          enginePreparation = host.prepareCluster(
            file,
            saved,
            budget,
            confirmed,
            confirmForLoad(operation, abort.signal),
          );
          await enginePreparation;
          if (operation !== epoch || quitting) return result();
          if (clusterCleanupFailed) throw Error('CLEANUP_FAILED');
          pendingCluster = {
            configurationId: saved.id,
            revision: saved.revision,
            runs: saved.runs,
          };
          await send(
            'load',
            {
              deploymentId: deps.deploymentId ?? 'desktop-development',
              sessionId: randomUUID(),
              operationId: randomUUID(),
              packageId: deps.packageId,
              modelId: currentModelId(),
            },
            { id: saved.id, revision: saved.revision, load: saved.load },
          );
          if (declinedMemoryOperation === operation && operation === epoch && !quitting) {
            await send('stop');
            view = { ...view, phase: 'stopped', error: null };
            declinedMemoryOperation = undefined;
          }
        } else if (command.action === 'stop') {
          selectedPeerRuns = [];
          clusterLoading?.abort();
          planning?.abort();
          ++epoch;
          await peerInterruption;
          if (host) await send('stop');
          else view = { ...view, phase: 'stopped', error: null };
        } else if (command.action === 'load') {
          await applyRuntimeSelection();
          planning?.abort();
          clusterLoading?.abort();
          await clusterTail;
          if (clusterCleanupFailed) throw Error('CLEANUP_FAILED');
          if (importing || view.restoring || runningConfiguration) throw new Error('BUSY');
          const source = sources.get(command.modelId);
          if (!source || source.speculativeHead) throw new Error('INVALID_MODEL_ID');
          if (!['stopped', 'failed'].includes(view.phase)) throw new Error('BUSY');
          const model = view.models?.find((entry) => entry.id === command.modelId);
          if (!model || model.unavailable) throw new Error('MODEL_FILE_UNAVAILABLE');
          const operation = ++epoch;
          loadingEpoch = operation;
          deps.loadingStatus?.begin();
          view = { ...view, model, phase: 'starting', error: null };
          file = source.file;
          await selectHistoryOwner(source);
          if (deps.createHistoryHost && preparation) await preparation;
          if (operation !== epoch || quitting) return result();
          await deps
            .inspect(file)
            .then((inspected) => {
              if (inspected.sha256 !== currentModelId()) throw new Error('UNSUPPORTED_MODEL');
            })
            .catch(() => {
              if (operation !== epoch || quitting) return;
              const model = view.model ? { ...view.model, unavailable: true } : null;
              if (model) updateModel(model);
              throw new Error('MODEL_FILE_UNAVAILABLE');
            });
          if (operation !== epoch || quitting) return result();
          if (
            command.draft &&
            (!host?.configuration ||
              !host.cluster ||
              !deps.preflightCluster ||
              !host.prepareCluster)
          )
            throw Error('NEEDS_RESOURCE_EVIDENCE');
          if (host?.configuration) {
            const settings = await host.configuration(caller, {
              action: 'read',
              modelId: currentModelId(),
            });
            if (!settings.ok) throw new Error('CONFIGURATION_UNAVAILABLE');
            if (
              settings.record.speculation?.enabled &&
              (!deps.preflightCluster ||
                !host.prepareCluster ||
                (!command.draft && !deps.planModel))
            )
              throw Error('NEEDS_SPECULATIVE_EVIDENCE');
            if ((deps.planModel || command.draft) && deps.preflightCluster && host.prepareCluster) {
              const abort = new AbortController();
              clusterLoading = abort;
              ownedClusterLoad = abort;
              const selectedFile = file;
              const readDraft = async () => {
                if (!command.draft || !host?.cluster || !source.blockCount)
                  throw Error('NEEDS_MODEL_METADATA');
                const reply = decodeClusterReply(
                  await host.cluster(caller, {
                    action: 'read',
                    modelId: source.modelId,
                    configurationId: command.draft.key.startsWith('config:')
                      ? command.draft.key.slice(7)
                      : null,
                  }),
                );
                if (!reply.ok) throw Error(reply.error);
                if (
                  !reply.draft ||
                  reply.draft.key !== command.draft.key ||
                  reply.draft.modelId !== source.modelId
                )
                  throw Error('STALE_CONFIGURATION');
                if (reply.draft.load.defaults.contextLength > source.contextLimit)
                  throw Error('INVALID_CLUSTER_CONFIGURATION');
                return reply.draft;
              };
              const selected = command.draft
                ? captureClusterDraft(
                    await readDraft(),
                    command.draft.revision,
                    source.blockCount!,
                    'b11306-four-slot',
                    randomUUID(),
                  )
                : await trackCluster(
                    () =>
                      deps.planModel!(
                        selectedFile,
                        settings.record,
                        abort.signal,
                        companionFor(settings.record.speculation),
                      ),
                    abort.signal,
                  );
              let budget: StockClusterReport;
              selectedPeerRuns = selected.runs;
              let confirmed = false;
              try {
                budget = await trackCluster(
                  () =>
                    deps.preflightCluster!(
                      selectedFile,
                      selected,
                      abort.signal,
                      false,
                      companionFor(selected.load.speculation),
                    ),
                  abort.signal,
                );
              } catch (error) {
                if (!(error instanceof Error) || error.message !== 'SHARED_GPU_MEMORY_CONFIRMATION')
                  throw error;
                if (operation !== epoch || quitting || abort.signal.aborted) return result();
                confirmed = await confirmMemory();
                if (operation !== epoch || quitting || abort.signal.aborted) return result();
                if (!confirmed) {
                  view = { ...view, phase: 'stopped', error: null };
                  return result();
                }
                if (operation !== epoch || quitting || abort.signal.aborted) return result();
                budget = await trackCluster(
                  () =>
                    deps.preflightCluster!(
                      selectedFile,
                      selected,
                      abort.signal,
                      true,
                      companionFor(selected.load.speculation),
                    ),
                  abort.signal,
                );
              }
              if (operation !== epoch || quitting || abort.signal.aborted) return result();
              if (command.draft) {
                const latest = captureClusterDraft(
                  await readDraft(),
                  command.draft.revision,
                  selected.blockCount,
                  selected.profileId,
                  selected.id,
                );
                if (!isDeepStrictEqual(latest, selected)) throw Error('STALE_CONFIGURATION');
              }
              if (operation !== epoch || quitting || abort.signal.aborted) return result();
              enginePreparation = host.prepareCluster(
                selectedFile,
                selected,
                budget,
                confirmed,
                confirmForLoad(operation, abort.signal),
              );
              await enginePreparation;
              if (operation !== epoch || quitting || abort.signal.aborted) return result();
              pendingCluster = command.draft
                ? {
                    configurationId: selected.id,
                    revision: selected.revision,
                    draftKey: command.draft.key,
                    runs: selected.runs,
                  }
                : null;
              await send(
                'load',
                {
                  deploymentId: deps.deploymentId ?? 'desktop-development',
                  sessionId: randomUUID(),
                  operationId: randomUUID(),
                  packageId: deps.packageId,
                  modelId: currentModelId(),
                },
                undefined,
                selected,
                command.draft,
              );
              if (declinedMemoryOperation === operation && operation === epoch && !quitting) {
                await send('stop');
                view = { ...view, phase: 'stopped', error: null };
                declinedMemoryOperation = undefined;
              }
              return result();
            }
            if (!isDeepStrictEqual(settings.record.load, settings.defaults.load))
              throw Error('NEEDS_RESOURCE_EVIDENCE');
          }
          try {
            await deps.preflight();
          } catch (error) {
            if (!(error instanceof Error) || error.message !== 'SHARED_GPU_MEMORY_CONFIRMATION')
              throw error;
            if (operation !== epoch || quitting) return result();
            const confirmed = await confirmMemory();
            if (operation !== epoch || quitting) return result();
            if (!confirmed) {
              view = { ...view, phase: 'stopped', error: null };
              return result();
            }
            await deps.preflight(true);
          }
          if (operation !== epoch || quitting) return result();
          if (!host) {
            preparation = deps.createHost(file);
            host = observeChat(await preparation);
          }
          if (operation !== epoch || quitting) return result();
          if (host.prepare) {
            enginePreparation = host.prepare(file);
            await enginePreparation;
          }
          if (operation !== epoch || quitting) return result();
          pendingCluster = null;
          await send('load', {
            deploymentId: deps.deploymentId ?? 'desktop-development',
            sessionId: randomUUID(),
            operationId: randomUUID(),
            packageId: deps.packageId,
            modelId: currentModelId(),
          });
        }
      } catch (error: unknown) {
        if (loadingEpoch !== undefined && (loadingEpoch !== epoch || quitting)) return result();
        const rejected =
          error instanceof Error && ['BUSY', 'INVALID_MODEL_ID'].includes(error.message);
        view = {
          ...view,
          phase:
            command.action === 'snapshot' ||
            command.action === 'remove' ||
            (command.action === 'run-configuration' && loadingEpoch === undefined) ||
            rejected
              ? view.phase
              : 'failed',
          error:
            error instanceof Error
              ? (messages[error.message] ??
                'The runtime operation failed. Stop and retry explicitly.')
              : 'The runtime operation failed.',
        };
      } finally {
        if (ownedClusterLoad && clusterLoading === ownedClusterLoad) clusterLoading = undefined;
        if (ownsConfigurationRun) runningConfiguration = false;
        if (
          (command.action === 'load' || command.action === 'run-configuration') &&
          (!loadingEpoch || loadingEpoch === epoch)
        )
          selectedPeerRuns = [];
      }
      return result();
    },
    async quit(): Promise<void> {
      clusterLoading?.abort();
      planning?.abort();
      quitting = true;
      unsubscribePeers?.();
      peerListeners.clear();
      const peerDraining = deps.enabled ? deps.beginPeerQuit?.() : undefined;
      void peerDraining?.catch(() => undefined);
      try {
        memoryDecision?.resolve(false);
        unsubscribe?.();
        chatListeners.clear();
        ++epoch;
        const pendingDevice = deviceProbe;
        // A pending picker owns no model handles; only selected-file indexing must settle.
        await Promise.allSettled([
          restoration,
          historySelection,
          removalPreparation,
          view.indexing ? importPreparation : undefined,
        ]);
        await usageProbe;
        await peerInterruption;
        await Promise.allSettled([...clusterOperations]);
        if (preparation) {
          try {
            host = await preparation;
          } catch {
            /* No host was created. */
          }
        }
        if (enginePreparation) {
          try {
            await enginePreparation;
          } catch {
            /* Failed preparation grants no engine authority. */
          }
        }
        if (host) {
          try {
            await send('quit');
          } catch (error: unknown) {
            if (!(error instanceof Error) || error.message !== 'CORE_EXITED') throw error;
            // A dead core cannot acknowledge Quit; retained main ownership still confirms every exit.
          }
          await host.close();
        }
        // Do not delay engine shutdown; diagnostic children still settle before main exits.
        if (pendingDevice)
          await pendingDevice.catch(() => {
            deviceCleanupFailed = true;
          });
        view = { ...view, phase: 'stopped' };
        if (deviceCleanupFailed) throw new Error('QUERY_CLEANUP_FAILED');
        if (clusterCleanupFailed) throw new Error('CLEANUP_FAILED');
      } finally {
        // Model shutdown releases its GPU reservations through the still-live peer owner.
        if (deps.enabled) {
          try {
            // A full owner close can settle an earlier failed sharing drain.
            await (deps.closePeers ? peerDraining?.catch(() => undefined) : peerDraining);
          } finally {
            await deps.closePeers?.();
          }
        }
      }
    },
  };
}
