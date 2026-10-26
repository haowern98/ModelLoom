export {
  decodeCacheCommand,
  decodeCacheReply,
} from '../../../../packages/core/src/tensor-cache/wire';
export type {
  CacheBridge,
  CacheCommand,
  CachePreferences,
  CacheReply,
  CacheView,
} from '../../../../packages/core/src/tensor-cache/wire';
import type { CacheBridge } from '../../../../packages/core/src/tensor-cache/wire';
declare global {
  interface Window {
    modelLoomCache?: CacheBridge;
  }
}
