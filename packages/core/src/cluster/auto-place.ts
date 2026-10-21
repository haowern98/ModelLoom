import type { GpuRun } from './contracts.js';
import { decodeClusterDevice } from './device-id.js';
export interface AutoCandidate {
  readonly runs: readonly GpuRun[];
  readonly pressure: number;
}
export type AutoPlaceResult =
  | { readonly code: 'PROPOSED'; readonly runs: readonly GpuRun[] }
  | { readonly code: 'NO_FIT' | 'UNSUPPORTED' | 'INCOMPLETE' | 'CANCELLED' };
/** Sequential, cancellable feasibility search. The owner supplies validated per-device budgets. */
export async function autoPlace(
  blockCount: number,
  uuids: readonly string[],
  evaluate: (runs: readonly GpuRun[], signal: AbortSignal) => Promise<AutoCandidate | null>,
  signal: AbortSignal,
  deadline = Date.now() + 120000,
  preferredCut?: number,
): Promise<AutoPlaceResult> {
  if (
    !Number.isSafeInteger(blockCount) ||
    blockCount < 1 ||
    blockCount > 16777214 ||
    uuids.length < 1 ||
    uuids.length > 2 ||
    new Set(uuids.map((u) => u.toLowerCase())).size !== uuids.length ||
    uuids.some((u) => {
      try {
        decodeClusterDevice(u);
        return false;
      } catch {
        return true;
      }
    })
  )
    return { code: 'UNSUPPORTED' };
  const ordered = [...uuids].sort();
  const check = () =>
    signal.aborted
      ? ('CANCELLED' as const)
      : Date.now() >= deadline
        ? ('INCOMPLETE' as const)
        : null;
  for (const count of [1, 2]) {
    let best: AutoCandidate | null = null;
    const candidates = function* (): Generator<readonly GpuRun[]> {
      if (count === 1) {
        for (const uuid of ordered) yield [{ uuid, first: 0, last: blockCount - 1 }];
      } else if (ordered.length === 2) {
        const center =
          preferredCut !== undefined &&
          Number.isSafeInteger(preferredCut) &&
          preferredCut >= 1 &&
          preferredCut < blockCount
            ? preferredCut
            : Math.floor(blockCount / 2);
        for (let distance = 0; distance < blockCount; distance++)
          for (const cut of distance === 0 ? [center] : [center - distance, center + distance]) {
            if (cut < 1 || cut >= blockCount) continue;
            for (const order of [ordered, [...ordered].reverse()])
              yield [
                { uuid: order[0]!, first: 0, last: cut - 1 },
                { uuid: order[1]!, first: cut, last: blockCount - 1 },
              ];
          }
      }
    };
    for (const runs of candidates()) {
      const stopped = check();
      if (stopped) return { code: stopped };
      const found = await evaluate(runs, signal);
      const after = check();
      if (after) return { code: after };
      if (
        found &&
        Number.isFinite(found.pressure) &&
        found.pressure >= 0 &&
        found.pressure <= 1 &&
        (!best || found.pressure < best.pressure)
      ) {
        // Native estimates are expensive; the first feasible split satisfies this bounded search.
        if (count === 2) return { code: 'PROPOSED', runs };
        best = { runs, pressure: found.pressure };
      }
    }
    if (best) return { code: 'PROPOSED', runs: best.runs };
  }
  return { code: 'NO_FIT' };
}
