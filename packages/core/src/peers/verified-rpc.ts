import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { InstalledPackage } from '../runtime-package/install.js';
import { requireInstalledLive, revalidateInstalled } from '../runtime-package/install.js';
import type { OwnedPeerRpc, PeerRpcBackend } from './rpc.js';
import {
  ConfirmedNetworkSetupFailure,
  launchOwnedRpcSession,
  launchOwnedSharingNetwork,
} from './rpc-relay.js';
import { privatePeerHost } from './wire.js';
import type { RpcRelaySession } from './rpc-session.js';
import { discoverResources } from '../hosts/resource-probe.js';
import { decodePeerResources, peerRuntimeId, rpcClientRuntimeId } from './resources.js';
import type { PeerResources } from './resources.js';
import { SHARING_APPROVAL_MS } from './deadline.js';
import { mkdir } from 'node:fs/promises';
import { cacheMaintenance } from '../tensor-cache/settings.js';
import type { CacheSettings } from '../tensor-cache/wire.js';

// Keep sealed identities when native teardown could not be established.
const unsettled = new Set<object>();
interface SharingPool {
  cacheSupported: boolean;
  sessions: Map<string, RpcRelaySession>;
  release(): void;
  uncertainLaunch: boolean;
  deadline: number;
  helperImage: string;
  networkOwned?: OwnedPeerRpc;
  preparingNetwork?: Promise<void>;
  draining: boolean;
}
const workerFiles = [
  'ModelLoom-peer-host.exe',
  'ggml-rpc-server.exe',
  'ggml.dll',
  'ggml-base.dll',
  'ggml-cpu-x64.dll',
  'ggml-cuda.dll',
  'ggml-rpc.dll',
  'cublas64_12.dll',
  'cublasLt64_12.dll',
  'cudart64_12.dll',
  'libomp.dll',
  'msvcp140.dll',
  'vcruntime140.dll',
  'vcruntime140_1.dll',
];

/** Accepts only a verifier-issued installation. Serialized paths and diagnostic
 * artifacts have no authority, including when their filenames happen to match. */
export class VerifiedRpcBackend implements PeerRpcBackend {
  private sharing: Promise<SharingPool> | undefined;
  private retained: SharingPool | undefined;
  private stopping: Promise<void> | undefined;
  private broken = false;
  private readonly preparedCaches = new Set<string>();
  constructor(
    private readonly installation: () => Promise<InstalledPackage>,
    private readonly cacheSettings?: () => Promise<CacheSettings>,
    private readonly cacheAvailability?: (location: string, available: boolean) => Promise<void>,
  ) {}

  async cacheEnabled(): Promise<boolean> {
    const installed = await this.installation();
    if (!requireInstalledLive(installed).version.endsWith('-tensor-cache-v1')) return false;
    return (await this.cacheSettings?.().catch(() => undefined))?.enabled ?? false;
  }

  async resources(gpuIds: readonly string[]): Promise<PeerResources> {
    const installed = await this.installation();
    const inventory = requireInstalledLive(installed);
    const runtimeId = peerRuntimeId(inventory);
    const clientRuntimeId = rpcClientRuntimeId(inventory);
    const snapshot = await discoverResources();
    const gpus = gpuIds.map((id) => {
      const matches = snapshot.gpus?.filter((gpu) => gpu.uuid.toLowerCase() === id.toLowerCase());
      if (matches?.length !== 1) throw Error('NEEDS_RESOURCE_EVIDENCE');
      const { uuid, bus, driver, total, free, mig, driverModel } = matches[0]!;
      return { uuid, bus, driver, total, free, mig, driverModel };
    });
    return decodePeerResources({ runtimeId, clientRuntimeId, ram: snapshot.ram, gpus });
  }

  private validate(gpuIds: readonly string[], max = 1): void {
    if (
      gpuIds.length < 1 ||
      gpuIds.length > max ||
      new Set(gpuIds.map((id) => id.toLowerCase())).size !== gpuIds.length ||
      gpuIds.some((id) => !/^GPU-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(id))
    )
      throw new Error('INVALID_GPU_RESERVATION');
  }

  /** Explicit local helper admission for every selected GPU before advertising availability. */
  async openSharing(gpuIds: readonly string[]): Promise<void> {
    this.validate(gpuIds, 16);
    if (this.broken) await this.closeSharing();
    if (this.sharing || this.stopping) throw new Error('RPC_BUSY');
    this.sharing = this.prepare([...gpuIds]);
    await this.sharing;
  }

  private async prepare(gpuIds: readonly string[]) {
    const installed = await this.installation();
    const inventory = requireInstalledLive(installed);
    if (
      inventory.backend !== 'cuda' ||
      inventory.protocol !== 1 ||
      inventory.upstreamCommit !== '4f31296a907d73f3409f720429bcf31111615d77' ||
      workerFiles.some((name) => !inventory.files.some((file) => file.path === name))
    )
      throw new Error('RPC_PACKAGE_REQUIRED');
    const files = await revalidateInstalled(installed);
    const current: SharingPool = {
      cacheSupported: inventory.version.endsWith('-tensor-cache-v1'),
      sessions: new Map(),
      release: () => files.release(),
      uncertainLaunch: false,
      deadline: performance.now() + SHARING_APPROVAL_MS,
      helperImage: path.join(installed.directory, 'ModelLoom-peer-host.exe'),
      draining: false,
    };
    this.retained = current;
    const deadline = current.deadline;
    try {
      for (const gpu of gpuIds) {
        const remaining = Math.floor(deadline - performance.now());
        if (remaining <= 0) throw Error('RPC_START_TIMEOUT');
        let session: RpcRelaySession;
        try {
          session = await launchOwnedRpcSession(
            {
              device: 'cuda',
              script: fileURLToPath(new URL('../../scripts/relay-rpc-worker.ps1', import.meta.url)),
              arguments: [
                '-HelperImage',
                path.join(installed.directory, 'ModelLoom-peer-host.exe'),
              ],
            },
            [gpu],
            Math.max(1, remaining),
          );
        } catch (error) {
          // A rejected native launch returns no ownership handle for confirmation.
          current.uncertainLaunch = true;
          throw error;
        }
        current.sessions.set(gpu.toLowerCase(), session);
      }
      return current;
    } catch (error) {
      // Earlier helpers still require confirmed teardown, even when no next launch was attempted.
      this.broken = true;
      unsettled.add(current);
      await this.drain(current).catch(() => undefined);
      throw error;
    }
  }

  async start(
    gpuIds: readonly string[],
    cacheRequested = false,
    cacheOwner?: string,
  ): Promise<OwnedPeerRpc> {
    this.validate(gpuIds);
    if (!this.sharing || this.stopping || this.broken) throw new Error('RPC_SHARING_REQUIRED');
    const current = await this.sharing;
    const session = current.sessions.get(gpuIds[0]!.toLowerCase());
    if (this.stopping || this.broken || !session) throw new Error('INVALID_GPU_RESERVATION');
    let cache: CacheSettings | undefined, selected: CacheSettings | undefined;
    if (
      cacheRequested &&
      current.cacheSupported &&
      typeof cacheOwner === 'string' &&
      /^[a-f0-9]{64}$/u.test(cacheOwner)
    ) {
      try {
        selected = await this.cacheSettings?.();
        if (selected?.enabled) {
          if (!this.preparedCaches.has(selected.location)) {
            await mkdir(selected.location, { recursive: true, mode: 0o700 });
            cacheMaintenance().prepare(selected.location);
            this.preparedCaches.add(selected.location);
          }
          cache = selected;
        }
      } catch {
        // Caching is optional; a corrupt preference or unavailable disk never
        // changes tensors or prevents an ordinary authenticated load.
      }
    }
    const worker = await (cache ? session.start(cache, cacheOwner) : session.start());
    if (selected?.enabled)
      await this.cacheAvailability?.(selected.location, Boolean(cache) && !worker.cacheError).catch(
        () => undefined,
      );
    return worker;
  }

  /** Local sharing admission only; remote GPU requests cannot create network helpers. */
  async openNetwork(address: string, lost: () => void): Promise<void> {
    if (!privatePeerHost(address)) throw Error('INVALID_CONTROL');
    if (!this.sharing || this.stopping || this.broken) throw Error('RPC_SHARING_REQUIRED');
    const current = await this.sharing;
    if (this.stopping || this.broken || current.draining) throw Error('RPC_SHARING_REQUIRED');
    if (current.networkOwned || current.preparingNetwork) throw Error('RPC_BUSY');
    const remaining = Math.floor(current.deadline - performance.now());
    if (remaining <= 0) throw Error('RPC_START_TIMEOUT');
    const preparing = (async () => {
      let network: OwnedPeerRpc;
      try {
        network = await launchOwnedSharingNetwork(
          {
            device: 'cpu',
            script: fileURLToPath(new URL('../../scripts/relay-rpc-worker.ps1', import.meta.url)),
            arguments: ['-HelperImage', current.helperImage, '-SharingAddress', address],
          },
          Math.max(1, remaining),
        );
      } catch (error) {
        if (!(error instanceof ConfirmedNetworkSetupFailure)) current.uncertainLaunch = true;
        this.broken = true;
        unsettled.add(current);
        throw error;
      }
      current.networkOwned = network;
      let notified = false;
      const onLost = () => {
        if (notified || current.draining) return;
        notified = true;
        this.broken = true;
        lost();
      };
      network.stream.on('error', onLost);
      network.stream.once('close', onLost);
      if (network.stream.destroyed) {
        onLost();
        throw Error('SHARING_FIREWALL_FAILED');
      }
    })();
    current.preparingNetwork = preparing;
    try {
      await preparing;
    } finally {
      if (current.preparingNetwork === preparing) delete current.preparingNetwork;
    }
  }

  private async drain(current: SharingPool): Promise<void> {
    current.draining = true;
    await current.preparingNetwork?.catch(() => undefined);
    let networkFailed = false;
    if (current.networkOwned) {
      try {
        await current.networkOwned.close();
        delete current.networkOwned;
      } catch {
        networkFailed = true;
      }
    }
    const results = await Promise.allSettled(
      [...current.sessions].map(async ([gpu, session]) => {
        await session.close();
        current.sessions.delete(gpu);
      }),
    );
    if (
      current.uncertainLaunch ||
      networkFailed ||
      results.some((result) => result.status === 'rejected')
    ) {
      unsettled.add(current);
      throw Error('RPC_CLEANUP_FAILED');
    }
    current.release();
    unsettled.delete(current);
    this.retained = undefined;
  }

  closeSharing(): Promise<void> {
    if (this.stopping) return this.stopping;
    const sharing = this.sharing;
    if (!sharing) {
      this.broken = false;
      return Promise.resolve();
    }
    return (this.stopping = (async () => {
      try {
        const current = await sharing.catch(() => this.retained);
        if (current) await this.drain(current);
        this.sharing = undefined;
        this.broken = false;
      } catch (error) {
        this.broken = true;
        throw error;
      } finally {
        this.stopping = undefined;
      }
    })());
  }
}
