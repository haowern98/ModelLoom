import { decodeCapturedClusterLoad, decodeClusterDraft } from './contracts.js';
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
/** Compile pure placement ratios, never runtime arguments or launch authority. */
export function compilePlacement(runs: readonly GpuRun[], blockCount: number): CompiledPlacement {
  const fail = (): never => {
    throw new Error('UNREPRESENTABLE_CLUSTER_PLACEMENT');
  };
  if (!supported(blockCount) || runs.length < 1 || runs.length > 2) return fail();
  const ordered = [...runs].sort((a, b) => a.first - b.first);
  if (
    new Set(ordered.map((r) => r.uuid.toLowerCase())).size !== ordered.length ||
    ordered.some(
      (r, i) =>
        !/^GPU-[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}$/u.test(r.uuid) ||
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
  if (ordered.length === 2) {
    const cut = ordered[1]!.first;
    const low = Math.fround((cut - 1) / (blockCount + 1));
    const high = Math.fround(cut / (blockCount + 1));
    const threshold = Math.fround((low + high) / 2);
    if (!(threshold > low && threshold < high)) return fail();
    const weights = [threshold, Math.fround(1 - threshold)].map((x) =>
      Math.fround(Number(String(x))),
    );
    const sum = Math.fround(weights[0]! + weights[1]!);
    const normalized = Math.fround(weights[0]! / sum);
    // The loader uses upper_bound: a slot exactly on the threshold goes right.
    // Monotonic float32 division makes these adjacent-slot checks exhaustive.
    if (!(low < normalized && normalized < high) || Math.fround(sum / sum) !== 1) return fail();
    tensorSplit = Object.freeze(weights);
  }
  return Object.freeze({
    orderedUuids: Object.freeze(ordered.map((r) => r.uuid)),
    tensorSplit,
    outputUuid: ordered.at(-1)!.uuid,
  });
}
