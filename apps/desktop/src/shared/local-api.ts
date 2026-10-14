export {
  decodeApiManagementCommand,
  decodeApiManagementReply,
} from '../../../../packages/core/src/local-api/wire';
export type {
  ApiManagementCommand,
  ApiManagementReply,
  ApiManagementStatus,
} from '../../../../packages/core/src/local-api/wire';
import type { ApiManagementBridge } from '../../../../packages/core/src/local-api/wire';
declare global {
  interface Window {
    modelLoomApi?: ApiManagementBridge;
  }
}
