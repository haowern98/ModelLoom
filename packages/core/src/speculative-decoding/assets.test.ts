import { expect, it } from 'vitest';
import { validateSpeculativeAssets } from './assets.js';
import type { GGUFInfo } from '../runtime/gguf.js';
import { speculationOff } from './contracts.js';
const target: GGUFInfo = {
  sha256: 'a'.repeat(64),
  architecture: 'qwen35',
  contextLimit: 65536,
  tensors: 100,
  blockCount: 65,
  nextnPredictLayers: 1,
  embeddingLength: 5120,
  tokenizerHash: 'c'.repeat(64),
};
const draft: GGUFInfo = {
  ...target,
  sha256: 'b'.repeat(64),
  blockCount: 24,
  nextnPredictLayers: 0,
};
const settings = {
  ...speculationOff(),
  enabled: true,
  proposer: {
    method: 'draft' as const,
    source: { kind: 'asset' as const, modelId: draft.sha256 },
    maxDraftTokens: 3,
  },
};
it('requires matching tokenizer contents rather than a vocabulary count or filename', () => {
  expect(() => validateSpeculativeAssets(settings, target, draft)).not.toThrow();
  expect(() =>
    validateSpeculativeAssets(settings, target, { ...draft, tokenizerHash: 'd'.repeat(64) }),
  ).toThrow('INCOMPATIBLE_SPECULATIVE_ASSET');
  expect(() =>
    validateSpeculativeAssets(settings, target, { ...draft, sha256: 'e'.repeat(64) }),
  ).toThrow('MODEL_FILE_UNAVAILABLE');
});
it('checks embedded MTP, companion kind, target widths and extraction layers', () => {
  const embedded = {
    ...settings,
    proposer: {
      ...settings.proposer,
      method: 'mtp' as const,
      source: { kind: 'embedded' as const },
    },
  };
  expect(() => validateSpeculativeAssets(embedded, target)).not.toThrow();
  expect(() => validateSpeculativeAssets(embedded, { ...target, nextnPredictLayers: 0 })).toThrow(
    'INCOMPATIBLE_SPECULATIVE_ASSET',
  );
  const dflash = { ...settings, proposer: { ...settings.proposer, method: 'dflash' as const } };
  const head = {
    ...draft,
    architecture: 'dflash',
    speculativeHead: 'dflash' as const,
    targetLayers: [6, 20, 34, 48, 62],
    draftBlockSize: 8,
  };
  expect(() => validateSpeculativeAssets(dflash, target, head)).not.toThrow();
  expect(() => validateSpeculativeAssets(dflash, target, { ...head, embeddingLength: 1 })).toThrow(
    'INCOMPATIBLE_SPECULATIVE_ASSET',
  );
  expect(() => validateSpeculativeAssets(dflash, target, { ...head, targetLayers: [65] })).toThrow(
    'INCOMPATIBLE_SPECULATIVE_ASSET',
  );
});
it('accepts reduced-width EAGLE3 only when its target feature width matches', () => {
  const settings = {
    ...speculationOff(),
    enabled: true,
    proposer: {
      method: 'eagle3' as const,
      source: { kind: 'asset' as const, modelId: draft.sha256 },
      maxDraftTokens: 3,
    },
  };
  const head = {
    ...draft,
    architecture: 'eagle3',
    speculativeHead: 'eagle3' as const,
    embeddingLength: 1024,
    targetHiddenSize: 5120,
    targetLayers: [1, 20, 40],
  };
  expect(() => validateSpeculativeAssets(settings, target, head)).not.toThrow();
  expect(() =>
    validateSpeculativeAssets(settings, target, { ...head, targetHiddenSize: 2048 }),
  ).toThrow('INCOMPATIBLE_SPECULATIVE_ASSET');
});
