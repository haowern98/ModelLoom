import { decodeCapturedClusterLoad, decodeClusterDraft, MAX_CLUSTER_GPUS } from './contracts.js';
import { decodeClusterDevice } from './device-id.js';
import type {
  AssignmentIssue,
  ClusterDraft,
  CompiledPlacement,
  GpuRun,
  PlacementValidation,
} from './contracts.js';

// Float32 represents every slot index exactly below this bound. Reject larger
// models explicitly rather than accepting ambiguous cuts or iterating over them.
const maximumBlocks = 16777214;
function supported(n: number): boolean {
  return Number.isSafeInteger(n) && n >= 1 && n <= maximumBlocks;
}
/** Validate retained editor strings without rewriting an incomplete draft. */
export function validateAssignment(draft: ClusterDraft, blockCount: number): PlacementValidation {
  const issues: AssignmentIssue[] = [];
  const issue = (
    uuid: string | null,
    field: AssignmentIssue['field'],
    code: AssignmentIssue['code'],
  ) => issues.push(Object.freeze({ uuid, field, code }));
  if (!supported(blockCount)) issue(null, 'coverage', 'unsupported-block-count');
  try {
    decodeCapturedClusterLoad(draft.load);
  } catch {
    issue(null, 'load', 'invalid-load');
  }
  try {
    decodeClusterDraft(draft);
  } catch {
    issue(null, 'coverage', 'invalid-runs');
  }
  const runs: GpuRun[] = [];
  if (!issues.length)
    for (const run of draft.runs) {
      const values: number[] = [];
      for (const field of ['first', 'last'] as const) {
        const raw = run[field];
        const n = Number(raw);
        if (!/^(0|[1-9][0-9]*)$/u.test(raw) || !Number.isSafeInteger(n))
          issue(run.uuid, field, 'invalid-integer');
        else if (n < 0 || n >= blockCount) issue(run.uuid, field, 'out-of-bounds');
        values.push(n);
      }
      const [first, last] = values as [number, number];
      if (first > last) issue(run.uuid, 'last', 'reversed');
      runs.push(Object.freeze({ uuid: run.uuid, first, last }));
    }
  runs.sort((a, b) => a.first - b.first);
  if (
    !issues.length &&
    (!runs.length ||
      runs[0]?.first !== 0 ||
      runs.at(-1)?.last !== blockCount - 1 ||
      runs.some((r, i) => i > 0 && r.first !== runs[i - 1]!.last + 1))
  )
    issue(null, 'coverage', 'coverage');
  return issues.length
    ? Object.freeze({ ok: false, issues: Object.freeze(issues) })
    : Object.freeze({ ok: true, runs: Object.freeze(runs) });
}
/** Match the loader's sequential float32 sum and normalization, including decimal serialization. */
export function placementThresholds(weights: readonly number[]): readonly number[] {
  if (
    !weights.length ||
    weights.length > MAX_CLUSTER_GPUS ||
    weights.some((weight) => !Number.isFinite(weight) || weight <= 0)
  )
    throw Error('UNREPRESENTABLE_CLUSTER_PLACEMENT');
  let sum = 0;
  const cumulative = weights.map(
    (weight) => (sum = Math.fround(sum + Math.fround(Number(String(weight))))),
  );
  const thresholds = cumulative.map((value) => Math.fround(value / sum));
  if (
    !Number.isFinite(sum) ||
    sum <= 0 ||
    thresholds.some(
      (value, i) => !Number.isFinite(value) || value <= (i ? thresholds[i - 1]! : 0),
    ) ||
    thresholds.at(-1) !== 1
  )
    throw Error('UNREPRESENTABLE_CLUSTER_PLACEMENT');
  return Object.freeze(thresholds);
}

/** Compile pure placement ratios, never runtime arguments or launch authority. */
export function compilePlacement(runs: readonly GpuRun[], blockCount: number): CompiledPlacement {
  const fail = (): never => {
    throw new Error('UNREPRESENTABLE_CLUSTER_PLACEMENT');
  };
  if (!supported(blockCount) || runs.length < 1 || runs.length > MAX_CLUSTER_GPUS) return fail();
  const ordered = [...runs].sort((a, b) => a.first - b.first);
  try {
    ordered.forEach((run) => decodeClusterDevice(run.uuid));
  } catch {
    return fail();
  }
  if (
    new Set(ordered.map((r) => r.uuid.toLowerCase())).size !== ordered.length ||
    ordered.some(
      (r, i) =>
        !Number.isSafeInteger(r.first) ||
        !Number.isSafeInteger(r.last) ||
        r.first < 0 ||
        r.last < r.first ||
        r.last >= blockCount ||
        r.first !== (i === 0 ? 0 : ordered[i - 1]!.last + 1),
    ) ||
    ordered.at(-1)?.last !== blockCount - 1
  )
    return fail();
  let tensorSplit: readonly number[] = Object.freeze([1]);
  if (ordered.length > 1) {
    const boundaries = ordered.slice(1).map((run) => {
      const low = Math.fround((run.first - 1) / (blockCount + 1));
      const high = Math.fround(run.first / (blockCount + 1));
      const midpoint = Math.fround((low + high) / 2);
      if (!(low < midpoint && midpoint < high)) return fail();
      return midpoint;
    });
    const weights = [...boundaries, 1].map((value, i) =>
      Math.fround(value - (i ? boundaries[i - 1]! : 0)),
    );
    const normalized = placementThresholds(weights);
    // The loader uses upper_bound: a slot exactly on the threshold goes right.
    // Monotonic float32 division makes these adjacent-slot checks exhaustive.
    for (let i = 0; i < ordered.length - 1; i++) {
      const cut = ordered[i + 1]!.first;
      if (!(
        Math.fround((cut - 1) / (blockCount + 1)) < normalized[i]! &&
        normalized[i]! < Math.fround(cut / (blockCount + 1))
      ))
        return fail();
    }
    tensorSplit = Object.freeze(weights);
  }
  return Object.freeze({
    orderedUuids: Object.freeze(ordered.map((r) => r.uuid)),
    tensorSplit,
    outputUuid: ordered.at(-1)!.uuid,
  });
}
