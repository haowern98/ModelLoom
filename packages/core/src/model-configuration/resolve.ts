import {
  decodeGenerationOverrides,
  decodeModelConfiguration,
  decodeResolvedRequestSettings,
} from './contracts.js';
import type {
  ActiveLoadSnapshot,
  GenerationOverrides,
  ModelConfigurationRecord,
  NativeGenerationParameters,
  ResolvedRequestSettings,
  RuntimeSettingCapabilities,
} from './contracts.js';

/** Resolve immutable request defaults against the active load, not a pending reload proposal. */
export function resolveRequestSettings(
  record: ModelConfigurationRecord,
  active: ActiveLoadSnapshot,
  overrides: GenerationOverrides,
  capabilities: RuntimeSettingCapabilities,
): ResolvedRequestSettings {
  const committed = decodeModelConfiguration(record, capabilities);
  if (
    committed.modelId !== active.modelId ||
    active.profileId !== capabilities.profileId ||
    !Number.isSafeInteger(active.revision) ||
    active.revision < 0 ||
    !Number.isSafeInteger(active.load.contextLength) ||
    active.load.contextLength < 1 ||
    active.load.contextLength > capabilities.contextLimit
  )
    throw new Error('INVALID_CONFIGURATION');
  const generation = committed.generation;
  if (generation.thinking !== null && !capabilities.thinking)
    throw new Error('UNSUPPORTED_SETTING');
  const parameters: NativeGenerationParameters = {
    ...capabilities.nativeDefaults,
    temperature: generation.temperature,
    top_k: generation.topK,
    top_p: generation.topP.enabled ? generation.topP.value : 1,
    min_p: generation.minP.enabled ? generation.minP.value : 0,
    repeat_penalty: generation.repeatPenalty.enabled ? generation.repeatPenalty.value : 1,
    presence_penalty: generation.presencePenalty.enabled ? generation.presencePenalty.value : 0,
    // The pinned llama.cpp sampler reserves UINT32_MAX for random seed selection.
    seed: generation.seed.enabled ? generation.seed.value : 4294967295,
    max_tokens: generation.responseLength.enabled ? generation.responseLength.value : -1,
    stop: generation.stopStrings,
    ...decodeGenerationOverrides(overrides, capabilities),
  };
  // Only resolved owner settings admit the unlimited sentinel; caller overrides stay positive.
  return decodeResolvedRequestSettings(
    {
      modelId: committed.modelId,
      activeLoadRevision: active.revision,
      generationRevision: committed.revision,
      profileId: active.profileId,
      contextLength: active.load.contextLength,
      parameters,
      systemPrompt: generation.systemPrompt,
      thinking: generation.thinking,
    },
    capabilities,
  );
}
