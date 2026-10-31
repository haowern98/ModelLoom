export {
  decodeRuntimeLogCommand,
  decodeRuntimeLogReply,
} from '../../../../packages/core/src/hosts/runtime-log-contracts';
export type {
  RuntimeLogCommand,
  RuntimeLogReply,
  RuntimeLogEntry,
  RuntimeLogSnapshot,
} from '../../../../packages/core/src/hosts/runtime-log-contracts';
import type { RuntimeLogsBridge } from '../../../../packages/core/src/hosts/runtime-log-contracts';
declare global {
  interface Window {
    modelLoomLogs?: RuntimeLogsBridge;
  }
}
