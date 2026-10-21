import { fileURLToPath } from 'node:url';
import type { PeerRpcBackend, OwnedPeerRpc } from './rpc.js';
import { launchOwnedRpcRelay } from './rpc-relay.js';
/** Fixed diagnostic artifacts only. Never supplied by desktop PeerOwner. */
export class DiagnosticRpcBackend implements PeerRpcBackend {
  constructor(private readonly device: 'cpu' | 'cuda') {}
  async start(gpuIds: readonly string[]): Promise<OwnedPeerRpc> {
    if (
      this.device === 'cuda' &&
      (gpuIds.length !== 1 ||
        !/^GPU-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(gpuIds[0]!))
    )
      throw new Error('INVALID_GPU_RESERVATION');
    return launchOwnedRpcRelay(
      {
        device: this.device,
        script: fileURLToPath(new URL('../../scripts/relay-network-worker.ps1', import.meta.url)),
        arguments: this.device === 'cuda' ? ['-Cuda'] : [],
      },
      gpuIds,
    );
  }
}
