export const capabilities = {
  profileId: 'fixture-four-slot',
  maxOutputTokens: 512,
  contextLimit: 7680,
  thinking: false,
  nativeDefaults: {
    temperature: 0.8,
    top_k: 40,
    top_p: 0.95,
    min_p: 0.05,
    repeat_penalty: 1,
    presence_penalty: 0,
    seed: 7,
    max_tokens: 512,
  },
};
const optional = (value: number, enabled = false) => ({ value, enabled });
export function record() {
  return {
    schemaVersion: 1 as const,
    modelId: 'a'.repeat(64),
    revision: 3,
    load: {
      automatic: false,
      contextLength: 7680,
      threads: null,
      evaluationBatch: 2048,
      physicalBatch: 512,
      concurrency: 4,
      flashAttention: true,
    },
    generation: {
      temperature: 0.8,
      topK: 40,
      topP: optional(0.95, true),
      minP: optional(0.05, true),
      repeatPenalty: optional(1),
      presencePenalty: optional(0),
      seed: optional(42),
      responseLength: optional(2048),
      systemPrompt: '',
      thinking: null,
      stopStrings: [] as string[],
    },
    preferences: {
      reasoningBudget: optional(8192),
      reasoningMessage: 'I have to answer now.',
      overflow: 'stop' as const,
      ropeBase: optional(10000),
      ropeScale: optional(1),
      customTemplate: false,
      chatTemplate: '',
      argumentsEnabled: false,
      argumentsText: '',
    },
  };
}
