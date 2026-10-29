import type {
  NeuralMethod,
  RetrievalMethod,
} from '../../../../../../packages/core/src/speculative-decoding/contracts';

/** Sample editor limits only; these do not establish runtime or hardware capabilities. */
export const numericSettings = {
  contextLength: { label: 'Context Length', initial: '8192', min: 1, step: 1 },
  threads: { label: 'CPU Thread Pool Size', initial: '7', min: 1, max: 64, step: 1 },
  evaluationBatch: { label: 'Evaluation Batch Size', initial: '2048', min: 1, step: 1 },
  physicalBatch: { label: 'Physical Batch Size', initial: '512', min: 1, step: 1 },
  concurrency: { label: 'Max Concurrent Predictions', initial: '4', min: 1, step: 1 },
  temperature: { label: 'Temperature', initial: '0.8', min: 0, max: 2, step: 0.01 },
  responseLength: { label: 'Maximum Response Length', initial: '2048', min: 1, step: 1 },
  reasoningBudget: { label: 'Reasoning Budget', initial: '8192', min: 1, step: 1 },
  topK: { label: 'Top K Sampling', initial: '40', min: 0, step: 1 },
  topP: { label: 'Top P Sampling', initial: '0.95', min: 0, max: 1, step: 0.01 },
  minP: { label: 'Min P Sampling', initial: '0.05', min: 0, max: 1, step: 0.01 },
  repeatPenalty: { label: 'Repeat Penalty', initial: '1.1', min: 0, step: 0.01 },
  presencePenalty: { label: 'Presence Penalty', initial: '0', min: -2, max: 2, step: 0.01 },
  ropeBase: { label: 'RoPE Frequency Base', initial: '10000', min: 1, step: 1 },
  ropeScale: { label: 'RoPE Frequency Scale', initial: '1', min: 0.01, step: 0.01 },
  seed: { label: 'Seed', initial: '0', min: 0, max: 4294967295, step: 1 },
} satisfies Record<
  string,
  { label: string; initial: string; min: number; max?: number; step: number }
>;

export type NumericSetting = keyof typeof numericSettings;
export type OptionalSetting =
  | 'responseLength'
  | 'reasoningBudget'
  | 'topP'
  | 'minP'
  | 'repeatPenalty'
  | 'presencePenalty'
  | 'ropeBase'
  | 'ropeScale'
  | 'seed';

/** Draft text stays intact until Save validates it; no field is passed to an engine. */
export interface DemoModelDefaults {
  speculation: {
    method: 'off' | NeuralMethod;
    source: string;
    maxDraftTokens: string;
    retrieval: 'off' | RetrievalMethod;
  };
  numbers: Record<NumericSetting, string>;
  enabled: Record<OptionalSetting, boolean>;
  systemPrompt: string;
  automatic: boolean;
  flashAttention: boolean;
  thinking: boolean;
  reasoningMessage: string;
  overflow: 'truncate-middle' | 'stop' | 'rolling';
  stopStrings: string[];
  stopInput: string;
  customTemplate: boolean;
  chatTemplate: string;
  argumentsEnabled: boolean;
  argumentsText: string;
}

export interface DemoConfiguration {
  saved: DemoModelDefaults;
  draft: DemoModelDefaults;
}

export function createDemoDefaults(): DemoModelDefaults {
  const numbers = {} as Record<NumericSetting, string>;
  for (const key of Object.keys(numericSettings) as NumericSetting[])
    numbers[key] = numericSettings[key].initial;
  return {
    speculation: { method: 'off', source: '', maxDraftTokens: '', retrieval: 'off' },
    numbers,
    enabled: {
      responseLength: false,
      reasoningBudget: true,
      topP: true,
      minP: true,
      repeatPenalty: true,
      presencePenalty: false,
      ropeBase: false,
      ropeScale: false,
      seed: false,
    },
    systemPrompt: '',
    automatic: false,
    flashAttention: true,
    thinking: true,
    reasoningMessage: 'I have to answer now.',
    overflow: 'stop',
    stopStrings: [],
    stopInput: '',
    customTemplate: false,
    chatTemplate: '',
    argumentsEnabled: false,
    argumentsText: '',
  };
}

/** Enabled controls are validated locally. Disabled manual values are retained, not applied. */
export function validateDemoDefaults(
  draft: DemoModelDefaults,
): Partial<Record<NumericSetting, string>> {
  const errors: Partial<Record<NumericSetting, string>> = {};
  for (const key of Object.keys(numericSettings) as NumericSetting[]) {
    if (key === 'contextLength' && draft.automatic) continue;
    if (Object.hasOwn(draft.enabled, key) && !draft.enabled[key as OptionalSetting]) continue;
    if (key === 'reasoningBudget' && !draft.thinking) continue;
    const rule: { label: string; min: number; max?: number; step: number } = numericSettings[key];
    const raw = draft.numbers[key];
    const value = Number(raw);
    if (
      !raw.trim() ||
      !Number.isFinite(value) ||
      value < rule.min ||
      (rule.max !== undefined && value > rule.max) ||
      (rule.step === 1 && !Number.isSafeInteger(value))
    ) {
      errors[key] =
        `${rule.label}: enter ${rule.step === 1 ? 'a whole number' : 'a number'} ${rule.max === undefined ? `of at least ${rule.min}` : `from ${rule.min} to ${rule.max}`}.`;
    }
  }
  if (
    !errors.physicalBatch &&
    !errors.evaluationBatch &&
    Number(draft.numbers.physicalBatch) > Number(draft.numbers.evaluationBatch)
  )
    errors.physicalBatch = 'Physical Batch Size must not exceed Evaluation Batch Size.';
  return errors;
}
