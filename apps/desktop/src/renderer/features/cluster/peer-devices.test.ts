import { expect, it } from 'vitest';
import { peerDevices } from './peer-devices';
import type { PeerView } from '../../../shared/peers';

it('shows only mutually approved GPU inventory, qualified by its installation', () => {
  const gpu = {
    id: 'GPU-11111111-1111-1111-1111-111111111111',
    name: 'Remote GPU',
    memoryBytes: 8 * 2 ** 30,
  };
  const request = {
    id: 'request',
    name: 'Malaysia',
    peerFingerprint: 'b'.repeat(64),
    phase: 'approved' as const,
    localVerified: true,
    remoteVerified: true,
    gpus: [gpu],
  };
  const view: PeerView = {
    fingerprint: 'a'.repeat(64),
    name: 'SG',
    sharing: false,
    addresses: [],
    gpus: [],
    sharedGpuIds: [],
    incoming: [],
    outgoing: [request],
  };
  expect(peerDevices(view)[0]?.hardware[0]?.assignmentId).toBe(`peer:${'b'.repeat(64)}:${gpu.id}`);
  expect(peerDevices({ ...view, outgoing: [{ ...request, remoteVerified: false }] })).toEqual([]);
  expect(peerDevices({ ...view, outgoing: [{ ...request, phase: 'disconnected' }] })).toEqual([]);
});
