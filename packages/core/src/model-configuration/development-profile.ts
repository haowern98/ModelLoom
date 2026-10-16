import type { Provenance } from '../history/store.js';
import type { LoadDefaults, RuntimeSettingCapabilities } from './contracts.js';

/** Pinned runtime sampler defaults with model-specific context and template capabilities. */
export function createConfigurationProfile(
  provenance: Provenance,
  model?: { contextLimit: number; thinkingSupported?: boolean },
): {
  load: LoadDefaults;
  capabilities: RuntimeSettingCapabilities;
} {
  if (provenance.upstreamCommit !== '4f31296a907d73f3409f720429bcf31111615d77')
    throw Error('UNSUPPORTED_RUNTIME');
  const cfg = provenance.configuration;
  if (provenance.packageId !== 'llama-cuda-development') throw Error('NEEDS_RESOURCE_EVIDENCE');
  return Object.freeze({
    load: Object.freeze({
      automatic: false,
      contextLength: Math.min(cfg.contextPerSlot, model?.contextLimit ?? cfg.contextPerSlot),
      threads: null,
      evaluationBatch: 2048,
      physicalBatch: 512,
      concurrency: cfg.slots,
      flashAttention: true,
    }),
    capabilities: Object.freeze({
      profileId: 'b11306-four-slot',
      contextLimit: model?.contextLimit ?? 2147483647,
      maxOutputTokens: 2147483647,
      thinking: model ? model.thinkingSupported === true : true,
      // Pinned native sampler defaults plus the explicit seed/temperature launch arguments.
      nativeDefaults: Object.freeze({
        temperature: cfg.temperature,
        top_k: 40,
        top_p: 0.95,
        min_p: 0.05,
        repeat_penalty: 1,
        presence_penalty: 0,
        seed: cfg.seed,
        max_tokens: Math.min(512, cfg.contextPerSlot),
      }),
    }),
  });
}
