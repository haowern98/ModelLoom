export {
  decodeConfigurationCommand,
  decodeConfigurationReply,
} from '../../../../packages/core/src/model-configuration/wire';
export type {
  ConfigurationCommand,
  ConfigurationReply,
  ConfigurationBridge,
} from '../../../../packages/core/src/model-configuration/wire';
export type { ModelConfigurationRecord } from '../../../../packages/core/src/model-configuration/contracts';
import type { ConfigurationBridge } from '../../../../packages/core/src/model-configuration/wire';
declare global {
  interface Window {
    modelLoomConfiguration?: ConfigurationBridge;
  }
}
