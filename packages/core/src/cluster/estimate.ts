import { localGpuBackend } from '../runtime-package/development-vulkan.js';
import type { ClusterEffectiveLoad } from './effective-load.js';
import { clusterDeviceNames } from './device-id.js';
import { executionDevices, nativeMethods } from '../speculative-decoding/execution.js';
export interface SpeculativeEstimateQualification {
  readonly version: 1;
  readonly method: string;
  readonly initialized: true;
  readonly sourceCommit: '4f31296a907d73f3409f720429bcf31111615d77';
  readonly hostExtraBytes: number;
  readonly hostBounded: true;
  readonly targetLayers: number;
  readonly targetHidden: number;
  readonly targetContext: number;
  readonly targetVocab: number;
}
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
  readonly speculation?: SpeculativeEstimateQualification;
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
  let speculation: SpeculativeEstimateQualification | undefined;
  if (load.speculation?.enabled) {
    const prefix = 'MODELLOOM_SPEC_ESTIMATE ';
    const line = rows.shift();
    if (!line?.startsWith(prefix)) return fail();
    let q: unknown;
    try {
      q = JSON.parse(line.slice(prefix.length));
    } catch {
      return fail();
    }
    if (!q || typeof q !== 'object' || Array.isArray(q)) return fail();
    const value = q as Record<string, unknown>;
    const method = [
      ...(load.speculation.retrieval ? [load.speculation.retrieval.method] : []),
      ...(load.speculation.proposer ? [nativeMethods[load.speculation.proposer.method]] : []),
    ].join(',');
    if (
      Object.keys(value).length !== 10 ||
      value.version !== 1 ||
      value.method !== method ||
      value.initialized !== true ||
      value.sourceCommit !== '4f31296a907d73f3409f720429bcf31111615d77' ||
      value.hostBounded !== true ||
      typeof value.hostExtraBytes !== 'number' ||
      !Number.isSafeInteger(value.hostExtraBytes) ||
      value.hostExtraBytes < 0 ||
      ['targetLayers', 'targetHidden', 'targetContext', 'targetVocab'].some(
        (key) =>
          typeof value[key] !== 'number' ||
          !Number.isSafeInteger(value[key]) ||
          Number(value[key]) < 1 ||
          Number(value[key]) > 2147483647,
      )
    )
      return fail();
    speculation = Object.freeze(value) as unknown as SpeculativeEstimateQualification;
  }
  const ids = executionDevices(load);
  const expected = [...clusterDeviceNames(ids, localGpuBackend(load.artifact)), 'Host'];
  if (rows.length !== expected.length) return fail();
  if (speculation) {
    const byName = new Map(rows.map((row) => [row.trim().split(/\s+/u)[0], row]));
    if (byName.size !== expected.length || expected.some((name) => !byName.has(name)))
      return fail();
    rows.splice(0, rows.length, ...expected.map((name) => byName.get(name)!));
  }
  const parsed = rows.map((row, i) => {
    const m = /^\s*((?:CUDA|Vulkan|RPC)\d+|Host)\s+(\d+)\s+(\d+)\s+(\d+)\s*$/u.exec(row);
    if (!m || m[1] !== expected[i]) return fail();
    const values = m.slice(2).map((v) => (Number(v) + 1) * 1048576);
    if (values.some((v) => !Number.isSafeInteger(v) || v < 1048576)) return fail();
    return Object.freeze({ model: values[0]!, context: values[1]!, compute: values[2]! });
  });
  return Object.freeze({
    fingerprint: load.fingerprint,
    orderedUuids: ids,
    devices: Object.freeze(ids.map((uuid, i) => Object.freeze({ ...parsed[i]!, uuid }))),
    host: parsed.at(-1)!,
    ...(speculation ? { speculation } : {}),
  });
}
