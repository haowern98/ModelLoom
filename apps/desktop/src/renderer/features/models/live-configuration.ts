import type { ModelConfigurationRecord } from '../../../shared/model-configuration';
import type { DemoModelDefaults, NumericSetting, OptionalSetting } from './configuration';

/** Populate the existing editor from committed runtime data, never sample defaults. */
export function toModelEditor(record: ModelConfigurationRecord): DemoModelDefaults {
  const { load, generation, preferences } = record;
  return {
    numbers: {
      contextLength: String(load.contextLength),
      threads: load.threads === null ? '' : String(load.threads),
      evaluationBatch: String(load.evaluationBatch),
      physicalBatch: String(load.physicalBatch),
      concurrency: String(load.concurrency),
      temperature: String(generation.temperature),
      responseLength: String(generation.responseLength.value),
      reasoningBudget: String(preferences.reasoningBudget.value),
      topK: String(generation.topK),
      topP: String(generation.topP.value),
      minP: String(generation.minP.value),
      repeatPenalty: String(generation.repeatPenalty.value),
      presencePenalty: String(generation.presencePenalty.value),
      ropeBase: String(preferences.ropeBase.value),
      ropeScale: String(preferences.ropeScale.value),
      seed: String(generation.seed.value),
    },
    enabled: {
      responseLength: generation.responseLength.enabled,
      reasoningBudget: preferences.reasoningBudget.enabled,
      topP: generation.topP.enabled,
      minP: generation.minP.enabled,
      repeatPenalty: generation.repeatPenalty.enabled,
      presencePenalty: generation.presencePenalty.enabled,
      ropeBase: preferences.ropeBase.enabled,
      ropeScale: preferences.ropeScale.enabled,
      seed: generation.seed.enabled,
    },
    systemPrompt: generation.systemPrompt,
    automatic: load.automatic,
    flashAttention: load.flashAttention,
    thinking: generation.thinking ?? true,
    reasoningMessage: preferences.reasoningMessage,
    overflow: preferences.overflow,
    stopStrings: [...generation.stopStrings],
    stopInput: '',
    customTemplate: preferences.customTemplate,
    chatTemplate: preferences.chatTemplate,
    argumentsEnabled: preferences.argumentsEnabled,
    argumentsText: preferences.argumentsText,
  };
}

/** Convert draft text without inventing values. Core still validates schema, ownership and support. */
export function fromModelEditor(
  draft: DemoModelDefaults,
  source: ModelConfigurationRecord,
): ModelConfigurationRecord {
  const number = (field: NumericSetting): number => {
    const raw = draft.numbers[field];
    if (!raw.trim() || !Number.isFinite(Number(raw))) throw Error('INVALID_CONFIGURATION');
    return Number(raw);
  };
  const optional = (field: OptionalSetting) => ({
    enabled: draft.enabled[field],
    value: number(field),
  });
  return {
    schemaVersion: 1,
    modelId: source.modelId,
    revision: source.revision,
    load: {
      automatic: draft.automatic,
      contextLength: number('contextLength'),
      threads: draft.numbers.threads === '' ? null : number('threads'),
      evaluationBatch: number('evaluationBatch'),
      physicalBatch: number('physicalBatch'),
      concurrency: number('concurrency'),
      flashAttention: draft.flashAttention,
    },
    generation: {
      temperature: number('temperature'),
      topK: number('topK'),
      topP: optional('topP'),
      minP: optional('minP'),
      repeatPenalty: optional('repeatPenalty'),
      presencePenalty: optional('presencePenalty'),
      seed: optional('seed'),
      responseLength: optional('responseLength'),
      systemPrompt: draft.systemPrompt,
      thinking: source.generation.thinking === null && draft.thinking ? null : draft.thinking,
      stopStrings: [...draft.stopStrings],
    },
    preferences: {
      reasoningBudget: optional('reasoningBudget'),
      reasoningMessage: draft.reasoningMessage,
      overflow: draft.overflow,
      ropeBase: optional('ropeBase'),
      ropeScale: optional('ropeScale'),
      customTemplate: draft.customTemplate,
      chatTemplate: draft.chatTemplate,
      argumentsEnabled: draft.argumentsEnabled,
      argumentsText: draft.argumentsText,
    },
  };
}
