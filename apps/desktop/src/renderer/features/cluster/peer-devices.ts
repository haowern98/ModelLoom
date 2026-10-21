import type { PeerView } from '../../../shared/peers';
import type { DemoDevice } from '../../mocks/cluster';
import { qualifyPeerGpu } from '../../../../../../packages/core/src/cluster/device-id';

/** Displayed inventory is never native launch authority. Run rechecks the peer. */
export function peerDevices(view: PeerView | null): readonly DemoDevice[] {
  return (view?.outgoing ?? [])
    .filter((peer) => peer.phase === 'approved' && peer.localVerified && peer.remoteVerified)
    .map((peer) => ({
      id: `peer:${peer.peerFingerprint}`,
      name: peer.name,
      role: 'Worker' as const,
      os: 'Not reported',
      address: 'Connected device',
      hardware: peer.gpus.map((gpu, index) => ({
        id: qualifyPeerGpu(peer.peerFingerprint, gpu.id),
        assignmentId: qualifyPeerGpu(peer.peerFingerprint, gpu.id),
        label: peer.gpus.length > 1 ? `GPU ${index}` : 'GPU',
        name: gpu.name,
        detail: `${(gpu.memoryBytes / 2 ** 30).toFixed(1)} GiB dedicated memory`,
        memoryGb: gpu.memoryBytes / 2 ** 30,
        kind: 'gpu' as const,
      })),
    }));
}
