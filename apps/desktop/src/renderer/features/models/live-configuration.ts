import type { ModelConfigurationRecord } from '../../../shared/model-configuration';
import {
  decodeSpeculativeDefaults,
  speculationOff,
} from '../../../../../../packages/core/src/speculative-decoding/contracts';
import {
  numericSettings,
  type DemoModelDefaults,
  type NumericSetting,
  type OptionalSetting,
} from './configuration';

/** Populate the existing editor from committed runtime data, never sample defaults. */
export function toModelEditor(record: ModelConfigurationRecord): DemoModelDefaults {
  const { load, generation, preferences } = record;
  const speculation = record.speculation ?? speculationOff();
  return {
    speculation: {
      method: speculation.enabled ? (speculation.proposer?.method ?? 'off') : 'off',
      source:
        speculation.proposer?.source.kind === 'embedded'
          ? 'embedded'
          : (speculation.proposer?.source.modelId ?? ''),
      maxDraftTokens:
        speculation.proposer?.maxDraftTokens == null
          ? ''
          : String(speculation.proposer.maxDraftTokens),
      retrieval: speculation.enabled ? (speculation.retrieval?.method ?? 'off') : 'off',
    },
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
  const original = toModelEditor(source);
  const retainedNumber = (field: NumericSetting, inactive: boolean): number => {
    const raw = draft.numbers[field];
    const value = Number(raw);
    const rule: { min: number; max?: number; step: number } = numericSettings[field];
    // Match the persisted contract even when an inactive field is not locally validated.
    const contractMax: Partial<Record<NumericSetting, number>> = {
      repeatPenalty: 100,
      responseLength: 2147483647,
      reasoningBudget: 2147483647,
      ropeBase: 1e12,
      ropeScale: 1e6,
    };
    const maximum = rule.max ?? contractMax[field];
    const valid =
      raw.trim() &&
      Number.isFinite(value) &&
      value >= rule.min &&
      (maximum === undefined || value <= maximum) &&
      (rule.step !== 1 || Number.isSafeInteger(value));
    if (inactive && !valid) return Number(original.numbers[field]);
    return number(field);
  };
  const optional = (field: OptionalSetting) => ({
    enabled: draft.enabled[field],
    value: retainedNumber(
      field,
      !draft.enabled[field] || (field === 'reasoningBudget' && !draft.thinking),
    ),
  });
  const spec = draft.speculation;
  const speculation = decodeSpeculativeDefaults({
    version: 1,
    enabled: spec.method !== 'off' || spec.retrieval !== 'off',
    proposer:
      spec.method === 'off'
        ? spec.retrieval === 'off'
          ? (source.speculation?.proposer ?? null)
          : null
        : {
            method: spec.method,
            source:
              spec.source === 'embedded'
                ? { kind: 'embedded' }
                : { kind: 'asset', modelId: spec.source },
            maxDraftTokens:
              spec.maxDraftTokens === ''
                ? null
                : /^\d+$/u.test(spec.maxDraftTokens)
                  ? Number(spec.maxDraftTokens)
                  : NaN,
          },
    retrieval:
      spec.retrieval === 'off'
        ? spec.method === 'off'
          ? (source.speculation?.retrieval ?? null)
          : null
        : { method: spec.retrieval },
  });
  return {
    schemaVersion: 2,
    speculation,
    modelId: source.modelId,
    revision: source.revision,
    load: {
      automatic: draft.automatic,
      contextLength: retainedNumber('contextLength', draft.automatic),
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
