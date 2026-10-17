import type { ClusterEffectiveLoad } from './effective-load.js';
export interface EstimateParts {
  readonly model: number;
  readonly context: number;
  readonly compute: number;
}
export interface CandidateEstimate {
  readonly fingerprint: string;
  readonly orderedUuids: readonly string[];
  readonly devices: readonly (EstimateParts & { readonly uuid: string })[];
  readonly host: EstimateParts;
}
/** Strict pinned fit-print data rows only; caller strips the owned-process framing first. */
export function parseClusterEstimate(
  output: Uint8Array,
  load: ClusterEffectiveLoad,
): CandidateEstimate {
  const fail = (): never => {
    throw Error('INVALID_ESTIMATE');
  };
  if (output.byteLength > 65536) return fail();
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(output).trim();
  } catch {
    return fail();
  }
  const rows = text.split(/\r?\n/u);
  const expected = [...load.placement.orderedUuids.map((_, i) => `CUDA${i}`), 'Host'];
  if (rows.length !== expected.length) return fail();
  const parsed = rows.map((row, i) => {
    const m = /^\s*(CUDA\d+|Host)\s+(\d+)\s+(\d+)\s+(\d+)\s*$/u.exec(row);
    if (!m || m[1] !== expected[i]) return fail();
    const values = m.slice(2).map((v) => (Number(v) + 1) * 1048576);
    if (values.some((v) => !Number.isSafeInteger(v) || v < 1048576)) return fail();
    return Object.freeze({ model: values[0]!, context: values[1]!, compute: values[2]! });
  });
  return Object.freeze({
    fingerprint: load.fingerprint,
    orderedUuids: load.placement.orderedUuids,
    devices: Object.freeze(
      load.placement.orderedUuids.map((uuid, i) => Object.freeze({ ...parsed[i]!, uuid })),
    ),
    host: parsed.at(-1)!,
  });
}
