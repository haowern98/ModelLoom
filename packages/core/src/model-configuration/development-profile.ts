import { isDeepStrictEqual } from 'node:util';
import type { Provenance } from '../history/store.js';
import { DEVELOPMENT_MEMORY_REPORTS } from '../runtime-package/development-policy.js';
import type { LoadDefaults, RuntimeSettingCapabilities } from './contracts.js';

/** Exact initial Windows development profile. New load tuples need separate resource evidence. */
export function createConfigurationProfile(provenance: Provenance): {
  load: LoadDefaults;
  capabilities: RuntimeSettingCapabilities;
} {
  if (provenance.upstreamCommit !== '4f31296a907d73f3409f720429bcf31111615d77')
    throw Error('UNSUPPORTED_RUNTIME');
  const report = DEVELOPMENT_MEMORY_REPORTS.find(
    (entry) =>
      entry.configuration.slots === 4 &&
      isDeepStrictEqual(entry.configuration, provenance.configuration),
  );
  if (!report || provenance.packageId !== 'llama-cuda-development')
    throw Error('NEEDS_RESOURCE_EVIDENCE');
  return Object.freeze({
    load: Object.freeze({
      automatic: false,
      contextLength: report.configuration.contextPerSlot,
      threads: null,
      evaluationBatch: 2048,
      physicalBatch: 512,
      concurrency: 4,
      flashAttention: true,
    }),
    capabilities: Object.freeze({
      profileId: 'b11306-four-slot',
      contextLimit: report.contextLimit,
      maxOutputTokens: 512,
      thinking: false,
      // Pinned native sampler defaults plus the explicit seed/temperature launch arguments.
      nativeDefaults: Object.freeze({
        temperature: report.configuration.temperature,
        top_k: 40,
        top_p: 0.95,
        min_p: 0.05,
        repeat_penalty: 1,
        presence_penalty: 0,
        seed: report.configuration.seed,
        max_tokens: 512,
      }),
    }),
  });
}
