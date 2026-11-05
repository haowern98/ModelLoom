import { createHash } from 'node:crypto';
import type { Inventory } from './inventory.js';

/** Separate Windows development package; CUDA package files are never replaced. */
export const VULKAN_DEVELOPMENT = {
  id: 'b11306-vulkan',
  packageId: 'llama-vulkan-development',
  upstreamCommit: '4f31296a907d73f3409f720429bcf31111615d77',
  artifact: 'b11306-vulkan-msvc14.44-dev1',
  inventorySha256: 'ed55b3f80525b04f47777d0d9af6ce08369cbbe617336020431ddb711dcee31e',
} as const;

/** Exact independent worker/client payloads; build labels cannot grant cross-backend compatibility. */
export const VULKAN_RPC_IDENTITIES = {
  cuda: {
    worker: '6b1e4eecd5fba9b281da51fb5b85b92c0a41ff9df5258134723e12ad47d2721b',
    client: '51add55141faf913e52da6cc27d37cd4f572c66f4363c6b0c7aa0ac9efe62d92',
  },
  vulkan: {
    worker: '654df43c276228dcee97eb1a3b80fdc992d3b7b326a12b0e22137a3b917af1fa',
    client: 'a175ea49398005d12cb0737a794d7c7a06b53d35009e7359f431ebda46e98c32',
  },
} as const;

/** Only the exact signed, locally qualified development payload can enter the Vulkan path. */
export function isDevelopmentVulkanInventory(inventory: Inventory): boolean {
  return (
    inventory.backend === 'vulkan' &&
    inventory.packageId === VULKAN_DEVELOPMENT.packageId &&
    createHash('sha256').update(JSON.stringify(inventory)).digest('hex') ===
      VULKAN_DEVELOPMENT.inventorySha256
  );
}

export function localGpuBackend(artifact: string): 'CUDA' | 'Vulkan' {
  return artifact === VULKAN_DEVELOPMENT.artifact ? 'Vulkan' : 'CUDA';
}
