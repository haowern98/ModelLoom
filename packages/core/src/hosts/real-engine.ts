import type { EngineAdapter, EngineExit, OwnedEngine } from '../runtime/engine-adapter.js';
import type { RuntimeConfiguration } from '../runtime/preflight.js';
import type { InstalledPackage } from '../runtime-package/install.js';
import {
  installedRealm,
  requireInstalledLive,
  revalidateInstalled,
} from '../runtime-package/install.js';
import { APPROVED_MEMORY_REPORTS } from '../runtime-package/trust-policy.js';
import {
  DEVELOPMENT_BUILD,
  DEVELOPMENT_MEMORY_REPORTS,
} from '../runtime-package/development-policy.js';
import { checkResources } from '../runtime/preflight.js';
import { checkCudaResources } from '../runtime/gpu-resources.js';
import { discoverResources } from './resource-probe.js';
import { inspectGGUF } from '../runtime/gguf.js';
import { decodeEvent } from '../runtime/contracts.js';
import { isDeepStrictEqual } from 'node:util';
import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { confirmExit, ownershipBinding } from './windows-ownership.js';
import {
  fixedArguments,
  clusterServerArguments,
  requireContextShiftSupport,
} from './runtime-arguments.js';
import type { ClusterEffectiveLoad } from '../cluster/effective-load.js';
import type { StockClusterReport } from '../cluster/stock-profile.js';
import { checkStockClusterResources } from '../cluster/stock-profile.js';
import { verifyStockPlacement } from '../cluster/stock-placement.js';
import { checkOwnedReadiness } from './readiness.js';
import { readOwnedSlots } from './slot-status.js';
import { OwnedSlotMonitor } from './slot-monitor.js';
import { createOwnedChatTransport } from './chat-transport.js';
import { GENERATION_POLICY } from '../generation/contracts.js';
import { createConfigurationProfile } from '../model-configuration/development-profile.js';
import type { ChatTransport } from '../generation/service.js';
import { createPeerRelays } from './peer-relays.js';
import type { OpenPeerRpc } from './peer-relays.js';
import { decodeClusterDevice } from '../cluster/device-id.js';
import type { ResourceSnapshot } from '../runtime/gpu-resources.js';
import {
  executionDevices,
  speculativeArguments,
  verifySpeculativeStartup,
} from '../speculative-decoding/execution.js';
import { validateSpeculativeAssets } from '../speculative-decoding/assets.js';

export interface RealEngineAdapter extends EngineAdapter {
  children(): readonly number[];
  admitCore(pid: number, expectedImage: string, launchTime: number): void;
  close(): Promise<void>;
  /** Private owner capability for this exact ready instance; never serialized to core/renderer. */
  slots(engine: OwnedEngine): OwnedSlotMonitor;
  /** Captured fixed Chat transport; credential/endpoint never leave the owner. */
  chat(engine: OwnedEngine): ChatTransport;
}
/** Shared adapter gated by package authority and an exact configuration-bound resource report.
 * Development reports require both a development capability and the explicit development build.
 * The optional trusted-owner callback consumes a one-use memory warning confirmation;
 * it is checked with fresh resources before creation and never comes from renderer data.
 */
export function realEngineAdapter(
  installed: InstalledPackage,
  model: string,
  configuration: RuntimeConfiguration,
  port: number,
  takeSharedMemoryConfirmation: () => boolean = () => false,
  cluster?: {
    readonly load: ClusterEffectiveLoad;
    readonly report: StockClusterReport;
    readonly confirmMemory?: () => Promise<boolean>;
    readonly peers?: {
      readonly open: OpenPeerRpc;
      resources(signal: AbortSignal): Promise<ResourceSnapshot>;
    };
  },
): RealEngineAdapter {
  const inventory = requireInstalledLive(installed);
  // Fixed argument/readiness behavior has only been inspected for this exact upstream source.
  if (inventory.upstreamCommit !== '4f31296a907d73f3409f720429bcf31111615d77')
    throw new Error('UNSUPPORTED_RUNTIME');
  const cfg = Object.freeze(structuredClone(configuration));
  if (
    cluster &&
    (installedRealm(installed) !== 'development' ||
      !DEVELOPMENT_BUILD ||
      inventory.packageId !== 'llama-cuda-development')
  )
    throw Error('NEEDS_RESOURCE_EVIDENCE');
  if (
    cluster &&
    (inventory.artifact !== cluster.load.artifact ||
      inventory.backend !== 'cuda' ||
      cluster.load.modelSha256 !== cfg.modelSha256 ||
      cluster.load.contextPerSlot !== cfg.contextPerSlot ||
      cluster.load.slots !== cfg.slots ||
      cluster.load.cacheK !== cfg.cacheK ||
      cluster.load.cacheV !== cfg.cacheV)
  )
    throw Error('NEEDS_RESOURCE_EVIDENCE');
  const reports =
    installedRealm(installed) === 'development' && DEVELOPMENT_BUILD
      ? DEVELOPMENT_MEMORY_REPORTS
      : APPROVED_MEMORY_REPORTS;
  const report = reports.find(
    (entry) =>
      entry.artifact === inventory.artifact &&
      entry.backend === inventory.backend &&
      isDeepStrictEqual(entry.configuration, cfg),
  );
  if (
    (!cluster && !report) ||
    (inventory.backend === 'cpu'
      ? cfg.gpuLayers !== 0 || cfg.gpuDevice !== undefined
      : !cfg.gpuDevice || cfg.gpuLayers === 0 || !inventory.minimumDriver)
  )
    throw new Error('NEEDS_RESOURCE_EVIDENCE');
  fixedArguments(model, cfg, port, 'key-file', 'configuration-check');
  if (
    cluster &&
    executionDevices(cluster.load).some((id) => decodeClusterDevice(id).kind === 'peer') &&
    !cluster.peers
  )
    throw Error('RPC_PACKAGE_REQUIRED');
  const native = ownershipBinding(),
    root = native.createDeployment();
  const active = new Map<object, Promise<EngineExit>>();
  const pids = new Map<object, number[]>();
  const slotMonitors = new WeakMap<OwnedEngine, OwnedSlotMonitor>();
  const chatTransports = new WeakMap<OwnedEngine, ChatTransport>();
  let closed = false,
    launching = false;
  return {
    chat(engine) {
      const transport = chatTransports.get(engine);
      if (closed || !transport) throw new Error('NOT_READY');
      return transport;
    },
    slots(engine) {
      const monitor = slotMonitors.get(engine);
      if (closed || !monitor) throw new Error('STATUS_UNCONFIRMED');
      return monitor;
    },
    children: () => [...pids.values()].flat(),
    admitCore(pid, image, time) {
      if (closed) throw new Error('OWNERSHIP_FAILED');
      native.admitCore(root, pid, image, time);
    },
    async launch(input, signal): Promise<OwnedEngine> {
      const event = decodeEvent(JSON.stringify({ type: 'start', selection: input }));
      if (
        event.type !== 'start' ||
        closed ||
        launching ||
        active.size ||
        signal.aborted ||
        event.selection.packageId !== inventory.packageId ||
        event.selection.modelId !== cfg.modelSha256
      )
        throw new Error('START_FAILED');
      launching = true;
      let packageLock: Awaited<ReturnType<typeof revalidateInstalled>> | undefined;
      let modelLock: object | undefined, credential: object | undefined;
      let relays: Awaited<ReturnType<typeof createPeerRelays>> | undefined;
      try {
        requireInstalledLive(installed);
        packageLock = await revalidateInstalled(installed);
        modelLock = native.sealFiles([
          path.resolve(model),
          ...(cluster?.report.companion ? [path.resolve(cluster.report.companion.file)] : []),
        ]);
        const info = await inspectGGUF(model);
        if (info.sha256 !== cfg.modelSha256 || cfg.contextPerSlot > info.contextLimit)
          throw new Error('INVALID_CONFIGURATION');
        validateSpeculativeAssets(
          cluster?.load.speculation,
          info,
          cluster?.report.companion ? await inspectGGUF(cluster.report.companion.file) : undefined,
        );
        if (
          cluster &&
          (info.blockCount !== cluster.load.blockCount ||
            cluster.report.cacheLayers.some(
              (kind, i) =>
                (kind === 'none') !== i >= cluster.load.blockCount - (info.nextnPredictLayers ?? 0),
            ))
        )
          throw Error('PLACEMENT_MISMATCH');
        if (signal.aborted || closed) throw new Error('START_FAILED');
        const secret = randomBytes(32).toString('base64url'),
          alias = `model-${randomUUID()}`;
        credential = native.createCredential(root, randomUUID(), secret);
        const keyFile = native.credentialPath(credential);
        // This durable bounded cache contains no credential. Reusing it avoids
        // per-load directories whose deletion depends on main surviving.
        const cacheDirectory = path.join(path.dirname(installed.directory), 'runtime-cache');
        native.privateDirectory(cacheDirectory);
        if (signal.aborted || closed) throw new Error('START_FAILED');
        // Metadata may expire while a large GGUF is hashed. Recheck immediately before creation.
        requireInstalledLive(installed);
        const resourceSnapshot = () =>
          cluster?.peers ? cluster.peers.resources(signal) : discoverResources(signal);
        const resources =
          inventory.backend === 'cuda'
            ? await resourceSnapshot()
            : { ram: native.availableMemory(), gpus: null };
        let admission = cluster
          ? checkStockClusterResources(
              cluster.load,
              cluster.report,
              resources,
              takeSharedMemoryConfirmation(),
            )
          : inventory.backend === 'cuda'
            ? checkCudaResources(
                cfg,
                inventory.artifact,
                report,
                resources,
                inventory.minimumDriver!,
                takeSharedMemoryConfirmation(),
              )
            : checkResources(cfg, inventory.artifact, inventory.backend, report, {
                ram: native.availableMemory(),
                vram: 0,
              });
        if (
          cluster &&
          admission.code === 'SHARED_GPU_MEMORY_CONFIRMATION' &&
          cluster.confirmMemory
        ) {
          if (signal.aborted || closed || !(await cluster.confirmMemory()))
            throw Error('START_FAILED');
          if (signal.aborted || closed) throw Error('START_FAILED');
          admission = checkStockClusterResources(
            cluster.load,
            cluster.report,
            await resourceSnapshot(),
            true,
          );
        }
        if (admission.code !== 'ADMITTED') throw new Error(admission.code);
        if (signal.aborted || closed) throw new Error('START_FAILED');
        requireInstalledLive(installed);
        const server = path.join(installed.directory, inventory.entrypoint);
        const helper = path.join(installed.directory, inventory.helper);
        let ownsCoordinator: (pid: number) => boolean = () => false;
        let peerLost = false;
        if (cluster)
          relays = await createPeerRelays(
            executionDevices(cluster.load),
            (pid) => ownsCoordinator(pid),
            cluster.peers?.open,
            () => {
              peerLost = true;
            },
          );
        const args = [
          server,
          ...(cluster
            ? [
                // Stock parses devices immediately, so register RPC endpoints first.
                ...relays!.arguments,
                ...clusterServerArguments(model, cluster.load, port, keyFile, alias),
                ...speculativeArguments(cluster.load, cluster.report.companion?.file),
                '--log-verbosity',
                '5',
              ]
            : fixedArguments(model, cfg, port, keyFile, alias)),
        ];
        const localDevices =
          cluster &&
          executionDevices(cluster.load).filter((id) => decodeClusterDevice(id).kind === 'local');
        const child =
          cluster && localDevices!.length
            ? native.launchCudaPlanConsole(root, helper, args, cacheDirectory, localDevices!)
            : cluster
              ? native.launchConsole(root, helper, args, cacheDirectory)
              : cfg.gpuDevice
                ? native.launchCudaConsole(root, helper, args, cacheDirectory, cfg.gpuDevice)
                : native.launchConsole(root, helper, args, cacheDirectory);
        const files = packageLock,
          selectedModel = modelLock,
          credentials = credential;
        const ownedRelays = relays;
        relays = undefined;
        packageLock = undefined;
        modelLock = undefined;
        credential = undefined;
        let ended = false,
          stopping = false,
          finishing = false,
          credentialDelivered = false,
          captured = false,
          ready = false,
          line = '',
          startupLog = '',
          startupFault: Error | undefined;
        let statusStopDeadline: number | undefined;
        let contextLength: number | undefined;
        let slotPreparation: Promise<OwnedSlotMonitor> | undefined;
        let resolveExit!: (receipt: EngineExit) => void, rejectExit!: (error: Error) => void;
        const exited = new Promise<EngineExit>((resolve, reject) => {
          resolveExit = resolve;
          rejectExit = reject;
        });
        void exited.catch(() => undefined);
        active.set(child, exited);
        const ownedPids: number[] = [];
        let serverPid: number | undefined;
        pids.set(child, ownedPids);
        const tick = () => {
          if (finishing) return;
          try {
            if (peerLost && !stopping && !ended) {
              stopping = true;
              startupFault = Error('RPC_DISCONNECTED');
              // Continue observing this retained job until every owned process exits.
              native.forceStop(child);
            }
            if (statusStopDeadline !== undefined && Date.now() >= statusStopDeadline) {
              native.forceStop(child);
              statusStopDeadline = undefined;
            }
            const observation = native.observe(child);
            const wasCaptured = captured;
            if (observation.pid && !ownedPids.includes(observation.pid))
              ownedPids.push(observation.pid);
            // A rejected startup capture can terminate the server before its receipt is admitted.
            // Confirm the empty exited job before trying to capture that dead PID again.
            if (!captured && observation.exitCode === -1) {
              line += observation.output;
              const newline = line.indexOf('\n');
              if (line.length > 65536) throw new Error('INVALID_CONTROL');
              if (newline !== -1) {
                const receipt = /^ENGINE ([1-9][0-9]*)\r?$/u.exec(line.slice(0, newline));
                if (!receipt) throw new Error('INVALID_CONTROL');
                native.captureServer(child, Number(receipt[1]), server);
                serverPid = Number(receipt[1]);
                if (!ownedPids.includes(Number(receipt[1]))) ownedPids.push(Number(receipt[1]));
                captured = true;
                startupLog = line.slice(newline + 1);
                line = '';
              }
            }
            if (captured && observation.exitCode === -1 && !credentialDelivered)
              credentialDelivered = native.deliverCredential(credentials, child);
            if (cluster && captured && !ready && !startupFault) {
              // The first captured chunk's remainder is already retained above.
              if (wasCaptured) startupLog += observation.output;
              if (Buffer.byteLength(startupLog) > 4194304) throw Error('PLACEMENT_MISMATCH');
              requireContextShiftSupport(cluster.load, startupLog);
            }
            if (observation.exitCode !== -1 && observation.activeProcesses === 0) {
              ended = true;
              finishing = true;
              clearInterval(timer);
              native.release(child);
              files.release();
              native.releaseFiles(selectedModel);
              native.releaseCredential(credentials);
              pids.delete(child);
              void Promise.resolve(ownedRelays?.close()).then(
                () => {
                  active.delete(child);
                  resolveExit({ code: observation.exitCode, signal: null });
                },
                () => rejectExit(Error('CLEANUP_FAILED')),
              );
            }
          } catch (error) {
            startupFault = error instanceof Error ? error : Error('START_FAILED');
            try {
              native.forceStop(child);
            } catch {
              rejectExit(new Error('CLEANUP_FAILED'));
            }
          }
        };
        const timer = setInterval(tick, 10);
        ownsCoordinator = (pid) => {
          tick();
          return !ended && captured && serverPid === pid;
        };
        tick();
        const owned: OwnedEngine = {
          selection: event.selection,
          exited,
          get contextLength() {
            return contextLength;
          },
          async waitReady(abort) {
            while (!ready) {
              if (startupFault) throw startupFault;
              if (abort.aborted || ended) {
                const failure = new Error(abort.aborted ? 'START_TIMEOUT' : 'START_FAILED');
                Object.defineProperty(failure, 'startupOutput', { value: startupLog });
                throw failure;
              }
              if (captured) {
                try {
                  const reportedContext = await checkOwnedReadiness(
                    port,
                    secret,
                    alias,
                    cfg.contextPerSlot,
                    cfg.slots,
                    () => !ended && native.ownedListener(child, port),
                    abort,
                  );
                  if (cluster) {
                    // HTTP readiness can precede draining the native allocation log.
                    if (
                      !startupLog.endsWith('\n') ||
                      !/(?:^|\n)[^\r\n]*llama_server: model loaded[^\r\n]*\r?\n/u.test(startupLog)
                    )
                      throw Error('NOT_READY');
                    verifySpeculativeStartup(cluster.load, startupLog);
                    // Each model emits the same allocation labels. Verify target section separately.
                    const targetLog = startupLog.split(
                      /(?:^|\n)[^\n]*common_speculative_init_result: (?:loading draft model|creating MTP draft context)/u,
                    )[0]!;
                    const targetSection =
                      targetLog === startupLog
                        ? targetLog
                        : `${targetLog}\n${startupLog.split('\n').find((line) => line.includes('llama_server: model loaded'))}\n`;
                    verifyStockPlacement(
                      targetSection,
                      cluster.load,
                      [
                        ...(resources.gpus ?? [])
                          .filter((g) => decodeClusterDevice(g.uuid).kind === 'local')
                          .map((g) => ({ uuid: g.uuid, pciBus: g.bus })),
                        ...(ownedRelays?.physical ?? []),
                      ],
                      cluster.report.cacheLayers,
                    );
                  }
                  // Concurrent readiness callers share one status preparation/monitor.
                  slotPreparation ??= (async () => {
                    const owns = () => !ended && !finishing && native.ownedListener(child, port);
                    // Native WAN state transfers can delay status; retain capacity
                    // within the existing generation deadline while waiting.
                    const observationMs =
                      cluster &&
                      executionDevices(cluster.load).some(
                        (id) => decodeClusterDevice(id).kind === 'peer',
                      )
                        ? GENERATION_POLICY.generationMs
                        : 5000;
                    const monitor = new OwnedSlotMonitor(
                      cfg.slots,
                      (signal) =>
                        readOwnedSlots(port, secret, cfg.slots, owns, signal, observationMs),
                      owns,
                      exited.then(() => undefined),
                      () => {
                        // Confirmed ownership scopes teardown; the existing tick confirms exit.
                        statusStopDeadline = Date.now() + 5000;
                        native.requestStop(child);
                      },
                      observationMs,
                    );
                    await monitor.initialize();
                    return monitor;
                  })();
                  const monitor = await slotPreparation;
                  if (abort.aborted || ended || closed) throw new Error('START_FAILED');
                  slotMonitors.set(owned, monitor);
                  chatTransports.set(
                    owned,
                    createOwnedChatTransport({
                      port,
                      key: secret,
                      alias,
                      session: event.selection,
                      owns: () => !ended && !finishing && native.ownedListener(child, port),
                      monitor,
                      exited: exited.then(() => undefined),
                      ...(inventory.packageId === 'llama-cuda-development'
                        ? {
                            configuration: {
                              capabilities: createConfigurationProfile(
                                {
                                  packageId: inventory.packageId,
                                  upstreamCommit: inventory.upstreamCommit,
                                  configuration: cfg,
                                },
                                info,
                              ).capabilities,
                              modelId: cfg.modelSha256,
                              contextLength: reportedContext,
                              overflow: cluster?.load.preferences?.overflow ?? 'stop',
                            },
                          }
                        : {}),
                    }),
                  );
                  native.releaseCredential(credentials);
                  contextLength = reportedContext;
                  ready = true;
                  startupLog = '';
                  return;
                } catch (error) {
                  if (
                    error instanceof Error &&
                    [
                      'PLACEMENT_MISMATCH',
                      'CONTEXT_MISMATCH',
                      'SPECULATIVE_INITIALIZATION_FAILED',
                    ].includes(error.message)
                  ) {
                    Object.defineProperty(error, 'startupOutput', { value: startupLog });
                    throw error;
                  }
                  if (abort.aborted || ended) throw new Error('START_FAILED', { cause: error });
                }
              }
              await new Promise<void>((resolve) => setTimeout(resolve, 50));
            }
          },
          requestStop() {
            stopping = true;
            if (!ended) {
              if (ready) native.requestStop(child);
              else native.forceStop(child);
            }
            return Promise.resolve();
          },
          forceStop() {
            stopping = true;
            if (!ended) native.forceStop(child);
            return Promise.resolve();
          },
        };
        void exited.then(
          () => slotMonitors.delete(owned),
          () => slotMonitors.delete(owned),
        );
        return owned;
      } finally {
        launching = false;
        await relays?.close();
        packageLock?.release();
        if (modelLock) native.releaseFiles(modelLock);
        if (credential) native.releaseCredential(credential);
      }
    },
    async close() {
      closed = true;
      native.closeDeployment(root);
      await confirmExit(() => !launching && active.size === 0 && native.coresExited(root));
    },
  };
}
