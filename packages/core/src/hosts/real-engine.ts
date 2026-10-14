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
import { fixedArguments } from './runtime-arguments.js';
import { checkOwnedReadiness } from './readiness.js';
import { readOwnedSlots } from './slot-status.js';
import { OwnedSlotMonitor } from './slot-monitor.js';
import { createOwnedChatTransport } from './chat-transport.js';
import { createConfigurationProfile } from '../model-configuration/development-profile.js';
import type { ChatTransport } from '../generation/service.js';

export interface RealEngineAdapter extends EngineAdapter {
  children(): readonly number[];
  admitCore(pid: number, expectedImage: string, launchTime: number): void;
  close(): Promise<void>;
  /** Private owner capability for this exact ready instance; never serialized to core/renderer. */
  slots(engine: OwnedEngine): OwnedSlotMonitor;
  /** Captured fixed Chat transport; credential/endpoint never leave the owner. */
  chat(engine: OwnedEngine): ChatTransport;
}
/** Shared adapter gated by package authority and exact reviewed memory reports.
 * Development reports require both a development capability and the explicit development build.
 */
export function realEngineAdapter(
  installed: InstalledPackage,
  model: string,
  configuration: RuntimeConfiguration,
  port: number,
): RealEngineAdapter {
  const inventory = requireInstalledLive(installed);
  // Fixed argument/readiness behavior has only been inspected for this exact upstream source.
  if (inventory.upstreamCommit !== '4f31296a907d73f3409f720429bcf31111615d77')
    throw new Error('UNSUPPORTED_RUNTIME');
  const cfg = Object.freeze(structuredClone(configuration));
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
    !report ||
    (inventory.backend === 'cpu'
      ? cfg.gpuLayers !== 0 || cfg.gpuDevice !== undefined
      : !cfg.gpuDevice || cfg.gpuLayers === 0 || !inventory.minimumDriver)
  )
    throw new Error('NEEDS_RESOURCE_EVIDENCE');
  fixedArguments(model, cfg, port, 'key-file', 'configuration-check');
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
      try {
        requireInstalledLive(installed);
        packageLock = await revalidateInstalled(installed);
        modelLock = native.sealFiles([path.resolve(model)]);
        const info = await inspectGGUF(model);
        if (info.sha256 !== cfg.modelSha256 || cfg.contextPerSlot > info.contextLimit)
          throw new Error('INVALID_CONFIGURATION');
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
        const admission =
          inventory.backend === 'cuda'
            ? checkCudaResources(
                cfg,
                inventory.artifact,
                report,
                await discoverResources(signal),
                inventory.minimumDriver!,
              )
            : checkResources(cfg, inventory.artifact, inventory.backend, report, {
                ram: native.availableMemory(),
                vram: 0,
              });
        if (admission.code !== 'ADMITTED') throw new Error(admission.code);
        if (signal.aborted || closed) throw new Error('START_FAILED');
        requireInstalledLive(installed);
        const server = path.join(installed.directory, inventory.entrypoint);
        const helper = path.join(installed.directory, inventory.helper);
        const args = [server, ...fixedArguments(model, cfg, port, keyFile, alias)];
        const child = cfg.gpuDevice
          ? native.launchCudaConsole(root, helper, args, cacheDirectory, cfg.gpuDevice)
          : native.launchConsole(root, helper, args, cacheDirectory);
        const files = packageLock,
          selectedModel = modelLock,
          credentials = credential;
        packageLock = undefined;
        modelLock = undefined;
        credential = undefined;
        let ended = false,
          finishing = false,
          credentialDelivered = false,
          captured = false,
          ready = false,
          line = '';
        let statusStopDeadline: number | undefined;
        let slotPreparation: Promise<OwnedSlotMonitor> | undefined;
        let resolveExit!: (receipt: EngineExit) => void, rejectExit!: (error: Error) => void;
        const exited = new Promise<EngineExit>((resolve, reject) => {
          resolveExit = resolve;
          rejectExit = reject;
        });
        void exited.catch(() => undefined);
        active.set(child, exited);
        const ownedPids: number[] = [];
        pids.set(child, ownedPids);
        const tick = () => {
          if (finishing) return;
          try {
            if (statusStopDeadline !== undefined && Date.now() >= statusStopDeadline) {
              native.forceStop(child);
              statusStopDeadline = undefined;
            }
            const observation = native.observe(child);
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
                if (!ownedPids.includes(Number(receipt[1]))) ownedPids.push(Number(receipt[1]));
                captured = true;
                line = '';
              }
            }
            if (captured && observation.exitCode === -1 && !credentialDelivered)
              credentialDelivered = native.deliverCredential(credentials, child);
            // Runtime output is drained and discarded, never exposed as credential-bearing diagnostics.
            if (observation.exitCode !== -1 && observation.activeProcesses === 0) {
              ended = true;
              finishing = true;
              clearInterval(timer);
              native.release(child);
              files.release();
              native.releaseFiles(selectedModel);
              native.releaseCredential(credentials);
              active.delete(child);
              pids.delete(child);
              resolveExit({ code: observation.exitCode, signal: null });
            }
          } catch {
            try {
              native.forceStop(child);
            } catch {
              rejectExit(new Error('CLEANUP_FAILED'));
            }
          }
        };
        const timer = setInterval(tick, 10);
        tick();
        const owned: OwnedEngine = {
          selection: event.selection,
          exited,
          async waitReady(abort) {
            while (!ready) {
              if (abort.aborted || ended) throw new Error('START_FAILED');
              if (captured) {
                try {
                  await checkOwnedReadiness(
                    port,
                    secret,
                    alias,
                    cfg.contextPerSlot,
                    cfg.slots,
                    () => !ended && native.ownedListener(child, port),
                    abort,
                  );
                  // Concurrent readiness callers share one status preparation/monitor.
                  slotPreparation ??= (async () => {
                    const owns = () => !ended && !finishing && native.ownedListener(child, port);
                    const monitor = new OwnedSlotMonitor(
                      cfg.slots,
                      (signal) => readOwnedSlots(port, secret, cfg.slots, owns, signal),
                      owns,
                      exited.then(() => undefined),
                      () => {
                        // Confirmed ownership scopes teardown; the existing tick confirms exit.
                        statusStopDeadline = Date.now() + 5000;
                        native.requestStop(child);
                      },
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
                      ...(inventory.packageId === 'llama-cuda-development' && cfg.slots === 4
                        ? {
                            configuration: {
                              capabilities: createConfigurationProfile({
                                packageId: inventory.packageId,
                                upstreamCommit: inventory.upstreamCommit,
                                configuration: cfg,
                              }).capabilities,
                              modelId: cfg.modelSha256,
                              contextLength: cfg.contextPerSlot,
                            },
                          }
                        : {}),
                    }),
                  );
                  native.releaseCredential(credentials);
                  ready = true;
                  return;
                } catch {
                  if (abort.aborted || ended) throw new Error('START_FAILED');
                }
              }
              await new Promise<void>((resolve) => setTimeout(resolve, 50));
            }
          },
          requestStop() {
            if (!ended) {
              if (ready) native.requestStop(child);
              else native.forceStop(child);
            }
            return Promise.resolve();
          },
          forceStop() {
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
