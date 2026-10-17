import type { ClusterBridge } from '../../../../packages/core/src/cluster/wire';
export {
  decodeClusterCommand,
  decodeClusterReply,
} from '../../../../packages/core/src/cluster/wire';
export type {
  ClusterBridge,
  ClusterCommand,
  ClusterReply,
} from '../../../../packages/core/src/cluster/wire';
export type {
  ClusterDraft,
  ClusterEdit,
  SavedClusterConfiguration,
  AssignmentIssue,
  CapturedClusterLoad,
  RawGpuRun,
} from '../../../../packages/core/src/cluster/contracts';
declare global {
  interface Window {
    modelLoomCluster?: ClusterBridge;
  }
}
