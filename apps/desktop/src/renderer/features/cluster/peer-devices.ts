import type { PeerView } from '../../../shared/peers';
import type { DemoDevice, DemoHardware } from '../../mocks/cluster';
import { qualifyPeerGpu } from '../../../../../../packages/core/src/cluster/device-id';

/** Displayed inventory is never native launch authority. Run rechecks the peer. */
export function peerDevices(view: PeerView | null): readonly DemoDevice[] {
  return (view?.outgoing ?? [])
    .filter((peer) => peer.phase === 'approved' && peer.localVerified && peer.remoteVerified)
    .map((peer) => {
      const facts = peer.hardware;
      const gpus = peer.gpus.map((gpu) => ({
        ...gpu,
        ...facts?.gpus.find((item) => item.id === gpu.id),
      }));
      const hardware: DemoHardware[] = [];
      if (facts?.cpuName)
        hardware.push({
          id: `peer:${peer.peerFingerprint}:cpu`,
          label: 'CPU',
          name: facts.cpuName,
          detail: [
            facts.cpuCores !== undefined ? `${facts.cpuCores} cores` : '',
            facts.threads !== undefined ? `${facts.threads} threads` : '',
          ]
            .filter(Boolean)
            .join(' · '),
          memoryGb: 0,
          kind: 'cpu',
        });
      hardware.push(
        ...gpus.map((gpu, index) => ({
          id: qualifyPeerGpu(peer.peerFingerprint, gpu.id),
          assignmentId: qualifyPeerGpu(peer.peerFingerprint, gpu.id),
          label: gpus.length > 1 ? `GPU ${index}` : 'GPU',
          name: gpu.name,
          detail: `${(gpu.memoryBytes / 2 ** 30).toFixed(1)} GiB dedicated memory`,
          memoryGb: gpu.memoryBytes / 2 ** 30,
          kind: 'gpu' as const,
        })),
      );
      return {
        id: `peer:${peer.peerFingerprint}`,
        name: peer.name,
        role: 'Worker' as const,
        os: facts?.os ?? 'Not reported',
        address: peer.address ?? 'Connected device',
        hardware,
        ...(facts
          ? {
              inventory: {
                sampledAt: facts.sampledAt,
                ...(facts.architecture !== undefined ? { architecture: facts.architecture } : {}),
                ...(facts.cpuCores !== undefined ? { cpuCores: facts.cpuCores } : {}),
                ...(facts.installedRamBytes !== undefined
                  ? { installedRamBytes: facts.installedRamBytes }
                  : {}),
                ...(facts.usableRamBytes !== undefined
                  ? { usableRamBytes: facts.usableRamBytes }
                  : {}),
                ...(facts.availableRamBytes !== undefined
                  ? { availableRamBytes: facts.availableRamBytes }
                  : {}),
                ...(facts.runtimeBackends !== undefined
                  ? { runtimeBackends: facts.runtimeBackends }
                  : {}),
                gpus: gpus.map((gpu) => ({
                  id: qualifyPeerGpu(peer.peerFingerprint, gpu.id),
                  name: gpu.name,
                  pciVendorId: '10de',
                  totalMemoryBytes: gpu.memoryBytes,
                  ...(gpu.availableMemoryBytes !== undefined
                    ? { availableMemoryBytes: gpu.availableMemoryBytes }
                    : {}),
                  ...(gpu.driverVersion !== undefined ? { driverVersion: gpu.driverVersion } : {}),
                })),
              },
            }
          : {}),
      };
    });
}
