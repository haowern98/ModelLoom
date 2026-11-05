const physical = /^GPU-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu;
const remote = /^peer:([a-f0-9]{64}):(GPU-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/iu;
export type ClusterDevice =
  | { readonly kind: 'local'; readonly uuid: string }
  | { readonly kind: 'peer'; readonly peer: string; readonly uuid: string };

/** Stable placement identity, never an address, display name or native ordinal. */
export function decodeClusterDevice(input: string): ClusterDevice {
  if (physical.test(input)) return { kind: 'local', uuid: input };
  const match = remote.exec(input);
  if (match) return { kind: 'peer', peer: match[1]!.toLowerCase(), uuid: match[2]! };
  throw new Error('INVALID_CLUSTER_DEVICE');
}
export function qualifyPeerGpu(fingerprint: string, uuid: string): string {
  if (!/^[a-f0-9]{64}$/u.test(fingerprint) || !physical.test(uuid))
    throw new Error('INVALID_CLUSTER_DEVICE');
  return `peer:${fingerprint}:${uuid}`;
}
/** Ordinals follow the owner's explicit local visibility and RPC endpoint order.
 * This does not authorize or open an endpoint; the peer owner must supply it. */
export function clusterDeviceNames(
  ids: readonly string[],
  backend: 'CUDA' | 'Vulkan' = 'CUDA',
): readonly string[] {
  let cuda = 0,
    rpc = 0;
  return ids.map((id) =>
    decodeClusterDevice(id).kind === 'local' ? `${backend}${cuda++}` : `RPC${rpc++}`,
  );
}
