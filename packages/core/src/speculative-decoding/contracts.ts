export const neuralMethods = ['mtp', 'draft', 'dflash', 'dspark', 'eagle3'] as const;
export const retrievalMethods = [
  'ngram-simple',
  'ngram-map-k',
  'ngram-map-k4v',
  'ngram-mod',
  'ngram-cache',
] as const;
export type NeuralMethod = (typeof neuralMethods)[number];
export type RetrievalMethod = (typeof retrievalMethods)[number];
export type ProposalSource =
  Readonly<{ kind: 'embedded' }> | Readonly<{ kind: 'asset'; modelId: string }>;
export interface SpeculativeDefaults {
  readonly version: 1;
  readonly enabled: boolean;
  readonly proposer: Readonly<{
    method: NeuralMethod;
    source: ProposalSource;
    maxDraftTokens: number | null;
  }> | null;
  readonly retrieval: Readonly<{ method: RetrievalMethod }> | null;
}
export function speculationOff(): SpeculativeDefaults {
  return Object.freeze({ version: 1, enabled: false, proposer: null, retrieval: null });
}
function invalid(): never {
  throw Error('INVALID_CONFIGURATION');
}
function object(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return invalid();
  const v = input as Record<string, unknown>;
  if (Object.keys(v).length !== keys.length || keys.some((key) => !Object.hasOwn(v, key)))
    return invalid();
  return v;
}
/** Saved intent only. This decoder grants neither asset access nor native execution authority. */
export function decodeSpeculativeDefaults(input: unknown): SpeculativeDefaults {
  const v = object(input, ['version', 'enabled', 'proposer', 'retrieval']);
  if (v.version !== 1 || typeof v.enabled !== 'boolean') return invalid();
  let proposer: SpeculativeDefaults['proposer'] = null;
  if (v.proposer !== null) {
    const p = object(v.proposer, ['method', 'source', 'maxDraftTokens']);
    if (!neuralMethods.includes(p.method as NeuralMethod)) return invalid();
    const source = p.source as Record<string, unknown> | null;
    let decoded: ProposalSource;
    if (source?.kind === 'embedded') {
      object(source, ['kind']);
      if (p.method !== 'mtp') return invalid();
      decoded = Object.freeze({ kind: 'embedded' });
    } else {
      const asset = object(source, ['kind', 'modelId']);
      if (
        asset.kind !== 'asset' ||
        typeof asset.modelId !== 'string' ||
        !/^[a-f0-9]{64}$/u.test(asset.modelId)
      )
        return invalid();
      decoded = Object.freeze({ kind: 'asset', modelId: asset.modelId });
    }
    if (
      p.maxDraftTokens !== null &&
      (typeof p.maxDraftTokens !== 'number' ||
        !Number.isSafeInteger(p.maxDraftTokens) ||
        p.maxDraftTokens < 1 ||
        p.maxDraftTokens > 256)
    )
      return invalid();
    proposer = Object.freeze({
      method: p.method as NeuralMethod,
      source: decoded,
      maxDraftTokens: p.maxDraftTokens,
    });
  }
  let retrieval: SpeculativeDefaults['retrieval'] = null;
  if (v.retrieval !== null) {
    const r = object(v.retrieval, ['method']);
    if (!retrievalMethods.includes(r.method as RetrievalMethod)) return invalid();
    retrieval = Object.freeze({ method: r.method as RetrievalMethod });
  }
  if (v.enabled && !proposer && !retrieval) return invalid();
  return Object.freeze({ version: 1, enabled: v.enabled, proposer, retrieval });
}
