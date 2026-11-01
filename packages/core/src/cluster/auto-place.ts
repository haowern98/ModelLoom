import type { GpuRun } from './contracts.js';
import { decodeClusterDevice } from './device-id.js';
import { MAX_CLUSTER_GPUS } from './contracts.js';
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
  search: {
    readonly maximumEvaluations?: number;
    readonly weights?: Readonly<Record<string, number>>;
  } = {},
): Promise<AutoPlaceResult> {
  if (
    !Number.isSafeInteger(blockCount) ||
    blockCount < 1 ||
    blockCount > 16777214 ||
    uuids.length < 1 ||
    uuids.length > MAX_CLUSTER_GPUS ||
    (search.maximumEvaluations !== undefined &&
      (!Number.isSafeInteger(search.maximumEvaluations) || search.maximumEvaluations < 1)) ||
    uuids.some(
      (uuid) =>
        search.weights?.[uuid] !== undefined &&
        (!Number.isSafeInteger(search.weights[uuid]) || search.weights[uuid] < 0),
    ) ||
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
  let evaluated = 0;
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
      } else if (ordered.length > 2) {
        yield* multiGpuCandidates(ordered, blockCount, search.weights);
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
      if (evaluated >= (search.maximumEvaluations ?? Infinity)) return { code: 'INCOMPLETE' };
      evaluated++;
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
  return { code: ordered.length > 2 ? 'INCOMPLETE' : 'NO_FIT' };
}

/** Larger sets use resource-weighted seeds, not an exponential exhaustive-cut claim. */
function* multiGpuCandidates(
  ids: readonly string[],
  blocks: number,
  weights: Readonly<Record<string, number>> | undefined,
): Generator<readonly GpuRun[]> {
  function* subsets(
    size: number,
    from = 0,
    prefix: readonly string[] = [],
  ): Generator<readonly string[]> {
    if (prefix.length === size) {
      yield prefix;
      return;
    }
    for (let i = from; i <= ids.length - (size - prefix.length); i++)
      yield* subsets(size, i + 1, [...prefix, ids[i]!]);
  }
  const sets = function* () {
    // Try the full canvas early so pair searches cannot consume the whole native budget.
    if (ids.length <= blocks) yield ids;
    for (let size = 2; size < ids.length && size <= blocks; size++) yield* subsets(size);
  };
  for (const subset of sets())
    for (const order of [subset, [...subset].reverse()]) {
      const capacity = order.map((id) => Math.max(1, weights?.[id] ?? 1));
      const total = capacity.reduce((sum, value) => sum + value, 0);
      let cumulative = 0,
        first = 0;
      yield order.map((uuid, i) => {
        cumulative += capacity[i]!;
        const end =
          i === order.length - 1
            ? blocks
            : Math.max(
                first + 1,
                Math.min(
                  blocks - (order.length - i - 1),
                  Math.round((blocks * cumulative) / total),
                ),
              );
        const run = { uuid, first, last: end - 1 };
        first = end;
        return run;
      });
    }
}
