import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { InstalledPackage } from '../runtime-package/install.js';
import { requireInstalledLive, revalidateInstalled } from '../runtime-package/install.js';
import type { OwnedPeerRpc, PeerRpcBackend } from './rpc.js';
import { launchOwnedRpcSession } from './rpc-relay.js';
import type { RpcRelaySession } from './rpc-session.js';
import { discoverResources } from '../hosts/resource-probe.js';
import { decodePeerResources, peerRuntimeId } from './resources.js';
import type { PeerResources } from './resources.js';

// Keep sealed identities when native teardown could not be established.
const unsettled = new Set<object>();
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
  private sharing:
    Promise<{ session: RpcRelaySession; gpu: string; release: () => void }> | undefined;
  private stopping: Promise<void> | undefined;
  private broken = false;
  constructor(private readonly installation: () => Promise<InstalledPackage>) {}

  async resources(gpuIds: readonly string[]): Promise<PeerResources> {
    const installed = await this.installation();
    const runtimeId = peerRuntimeId(requireInstalledLive(installed));
    const snapshot = await discoverResources();
    const gpus = gpuIds.map((id) => {
      const matches = snapshot.gpus?.filter((gpu) => gpu.uuid.toLowerCase() === id.toLowerCase());
      if (matches?.length !== 1) throw Error('NEEDS_RESOURCE_EVIDENCE');
      const { uuid, bus, driver, total, free, mig, driverModel } = matches[0]!;
      return { uuid, bus, driver, total, free, mig, driverModel };
    });
    return decodePeerResources({ runtimeId, ram: snapshot.ram, gpus });
  }

  private validate(gpuIds: readonly string[]): void {
    if (
      gpuIds.length !== 1 ||
      !/^GPU-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(gpuIds[0]!)
    )
      throw new Error('INVALID_GPU_RESERVATION');
  }

  /** One explicit local elevation before advertising sharing availability. */
  async openSharing(gpuIds: readonly string[]): Promise<void> {
    this.validate(gpuIds);
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
    try {
      const session = await launchOwnedRpcSession(
        {
          device: 'cuda',
          script: fileURLToPath(new URL('../../scripts/relay-rpc-worker.ps1', import.meta.url)),
          arguments: ['-HelperImage', path.join(installed.directory, 'ModelLoom-peer-host.exe')],
        },
        gpuIds,
      );
      return { session, gpu: gpuIds[0]!.toLowerCase(), release: () => files.release() };
    } catch (error) {
      unsettled.add(files);
      throw error;
    }
  }

  async start(gpuIds: readonly string[]): Promise<OwnedPeerRpc> {
    this.validate(gpuIds);
    if (!this.sharing || this.stopping || this.broken) throw new Error('RPC_SHARING_REQUIRED');
    const current = await this.sharing;
    if (this.stopping || current.gpu !== gpuIds[0]!.toLowerCase())
      throw new Error('INVALID_GPU_RESERVATION');
    return current.session.start();
  }

  closeSharing(): Promise<void> {
    if (this.stopping) return this.stopping;
    const sharing = this.sharing;
    if (!sharing) return Promise.resolve();
    return (this.stopping = (async () => {
      try {
        const current = await sharing;
        try {
          await current.session.close();
          current.release();
          unsettled.delete(current);
          this.sharing = undefined;
          this.broken = false;
        } catch (error) {
          unsettled.add(current);
          throw error;
        }
      } catch (error) {
        this.broken = true;
        throw error;
      } finally {
        this.stopping = undefined;
      }
    })());
  }
}
