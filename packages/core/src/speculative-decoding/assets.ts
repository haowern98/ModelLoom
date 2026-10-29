import type { SpeculativeDefaults } from './contracts.js';
import type { GGUFInfo } from '../runtime/gguf.js';
import type { ModelSource } from '../model-configuration/model-source.js';
export type SpeculativeCompanion = Readonly<
  Pick<ModelSource, 'modelId' | 'file' | 'sizeBytes' | 'modifiedMs'>
>;
/** Content/shape compatibility, supplemented by native initialization before activation. */
export function validateSpeculativeAssets(
  spec: SpeculativeDefaults | undefined,
  target: GGUFInfo,
  companion?: GGUFInfo,
): void {
  if (!spec?.enabled || !spec.proposer) return;
  const p = spec.proposer;
  const invalid = (): never => {
    throw Error('INCOMPATIBLE_SPECULATIVE_ASSET');
  };
  if (p.source.kind === 'embedded') {
    if (p.method !== 'mtp' || !target.nextnPredictLayers || !target.embeddingLength) invalid();
    return;
  }
  if (!companion || companion.sha256 !== p.source.modelId) throw Error('MODEL_FILE_UNAVAILABLE');
  if (p.method === 'draft') {
    if (
      companion.speculativeHead ||
      !target.tokenizerHash ||
      target.tokenizerHash !== companion.tokenizerHash
    )
      invalid();
    return;
  }
  if (
    companion.speculativeHead !== p.method ||
    !target.embeddingLength ||
    (p.method === 'eagle3' ? companion.targetHiddenSize : companion.embeddingLength) !==
      target.embeddingLength
  )
    invalid();
  if (p.method === 'mtp') {
    if (
      companion.architecture !== target.architecture ||
      (companion.tokenizerHash && companion.tokenizerHash !== target.tokenizerHash)
    )
      invalid();
  } else {
    const layers = companion.targetLayers;
    if (
      !target.blockCount ||
      !layers?.length ||
      layers.some(
        (layer) => layer < 0 || layer >= target.blockCount! - (target.nextnPredictLayers ?? 0),
      )
    )
      invalid();
    if (p.method === 'eagle3' && layers?.length !== 3) invalid();
    if ((p.method === 'dflash' || p.method === 'dspark') && !companion.draftBlockSize) invalid();
    // Native clamps the requested width against trained block/anchor metadata.
  }
}
