import type { PlannerReport } from '../runtime/preflight.js';
import type { RuntimePackageDescription } from './inventory.js';
/** Public trust anchor pinned to the bytes exported by the production publisher. */
export const APPROVED_RUNTIME_ROOTS: readonly Readonly<{ asset: string; sha256: string }>[] =
  Object.freeze([
    Object.freeze({
      asset: 'production-root-v1.json',
      sha256: '055cefc8ef6eb9906522514b8cebf8cc4d2e14deb9d40b3c8f90f54a796d886b',
    }),
  ]);
export const APPROVED_MEMORY_REPORTS: readonly PlannerReport[] = Object.freeze([]);

export const APPROVED_RUNTIME_CATALOGS: readonly {
  readonly endpoints: { metadata: string; assets: string };
  readonly offers: readonly { build: RuntimePackageDescription; size: string }[];
}[] = Object.freeze([]);
