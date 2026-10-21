import { localRpcGateway } from '../peers/rpc.js';
import type { Duplex } from 'node:stream';
import { decodeClusterDevice } from '../cluster/device-id.js';
import type { PhysicalPlacementDevice } from '../cluster/stock-placement.js';

export type OpenPeerRpc = (device: string) => Promise<Duplex>;
/** Runtime owner capability. Endpoint order follows explicit placement order;
 * no address or port is accepted from persisted settings or renderer input. */
export async function createPeerRelays(
  devices: readonly string[],
  allowed: (pid: number) => boolean,
  open?: OpenPeerRpc,
  lost?: () => void,
) {
  const remote = devices.filter((id) => decodeClusterDevice(id).kind === 'peer');
  if (remote.length && !open) throw Error('RPC_PACKAGE_REQUIRED');
  const gateways: Awaited<ReturnType<typeof localRpcGateway>>[] = [];
  const physical: PhysicalPlacementDevice[] = [];
  const close = async () => {
    const results = await Promise.allSettled(gateways.map((gateway) => gateway.close()));
    if (results.some((result) => result.status === 'rejected')) throw Error('RPC_CLEANUP_FAILED');
  };
  try {
    for (const uuid of remote) {
      const gateway = await localRpcGateway(allowed, () => open!(uuid), lost);
      gateways.push(gateway);
      physical.push({ uuid, rpcEndpoint: `127.0.0.1:${gateway.port}` });
    }
    return {
      physical: Object.freeze(physical),
      arguments: remote.length
        ? ['--rpc', physical.map((value) => value.rpcEndpoint).join(',')]
        : [],
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
