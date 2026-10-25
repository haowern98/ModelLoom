export {
  decodeNetworkCommand,
  decodeNetworkReply,
} from '../../../../packages/core/src/network/wire';
export type {
  NetworkBridge,
  NetworkCommand,
  NetworkView,
  NetworkReply,
} from '../../../../packages/core/src/network/wire';
import type { NetworkBridge } from '../../../../packages/core/src/network/wire';
declare global {
  interface Window {
    modelLoomNetwork?: NetworkBridge;
  }
}
