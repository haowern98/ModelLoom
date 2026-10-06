import type { PlannerReport } from '../runtime/preflight.js';
/** Reviewed public build inputs only. No live root or validated memory report has been provisioned. */
export const APPROVED_RUNTIME_ROOTS: readonly Readonly<{ asset: string; sha256: string }>[] =
  Object.freeze([]);
export const APPROVED_MEMORY_REPORTS: readonly PlannerReport[] = Object.freeze([]);
