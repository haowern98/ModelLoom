import { expect, it } from 'vitest';
import { qualifyPeerGpu, decodeClusterDevice, clusterDeviceNames } from './device-id.js';

const uuid = 'GPU-11111111-1111-1111-1111-111111111111';
it('keeps the same physical UUID distinct between two approved installations', () => {
  const first = qualifyPeerGpu('a'.repeat(64), uuid);
  const second = qualifyPeerGpu('b'.repeat(64), uuid);
  expect(first).not.toBe(second);
  expect(decodeClusterDevice(first)).toEqual({ kind: 'peer', peer: 'a'.repeat(64), uuid });
  expect(decodeClusterDevice(uuid)).toEqual({ kind: 'local', uuid });
});
it('maps explicit layer order to native CUDA/RPC names without treating a peer UUID as local', () => {
  const remote = qualifyPeerGpu('a'.repeat(64), uuid);
  expect(clusterDeviceNames([uuid, remote])).toEqual(['CUDA0', 'RPC0']);
  expect(clusterDeviceNames([remote, uuid])).toEqual(['RPC0', 'CUDA0']);
});
it.each(['peer:host:GPU-0', `peer:${'a'.repeat(64)}:${uuid}:extra`, 'CUDA0', 'RPC0', '../GPU-0'])(
  'rejects non-identity placement selectors: %s',
  (value) => {
    expect(() => decodeClusterDevice(value)).toThrow('INVALID_CLUSTER_DEVICE');
  },
);
