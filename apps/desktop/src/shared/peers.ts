import type { PeerBridge } from '../../../../packages/core/src/peers/wire';
export { decodePeerCommand, decodePeerReply } from '../../../../packages/core/src/peers/wire';
export type {
  PeerBridge,
  PeerCommand,
  PeerReply,
  PeerView,
  PeerGpuView,
  PeerTelemetry,
} from '../../../../packages/core/src/peers/wire';
declare global {
  interface Window {
    modelLoomPeers?: PeerBridge;
  }
}
