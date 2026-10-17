import { expect, it } from 'vitest';
import {
  createModelConfiguration,
  decodeModelConfiguration,
  decodeGenerationOverrides,
  decodeResolvedRequestSettings,
} from './contracts.js';

import { capabilities, record } from './test-fixtures.js';
import { resolveRequestSettings } from './resolve.js';

it('retains unlimited captured requests without accepting negative caller overrides', () => {
  const source = record();
  const captured = resolveRequestSettings(
    source,
    {
      modelId: source.modelId,
      revision: 1,
      profileId: capabilities.profileId,
      load: source.load,
    },
    {},
    capabilities,
  );
  expect(
    decodeResolvedRequestSettings(JSON.parse(JSON.stringify(captured)), capabilities).parameters
      .max_tokens,
  ).toBe(-1);
  for (const max_tokens of [-2, 0, 1.5, Infinity])
    expect(() =>
      decodeResolvedRequestSettings(
        { ...captured, parameters: { ...captured.parameters, max_tokens } },
        capabilities,
      ),
    ).toThrow('INVALID_CONFIGURATION');
  expect(() => decodeGenerationOverrides({ max_tokens: -1 }, capabilities)).toThrow(
    'INVALID_CONFIGURATION',
  );
});

it('initializes actual profile defaults instead of importing the preview editor values', () => {
  const profile = {
    ...capabilities,
    nativeDefaults: {
      ...capabilities.nativeDefaults,
      temperature: 0.15,
      top_k: 7,
      repeat_penalty: 1.25,
      seed: 19,
    },
  };
  const created = createModelConfiguration('a'.repeat(64), record().load, profile);
  expect(created.revision).toBe(0);
  expect(created.generation.temperature).toBe(0.15);
  expect(created.generation.topK).toBe(7);
  expect(created.generation.repeatPenalty).toEqual({ enabled: true, value: 1.25 });
  expect(created.generation.seed).toEqual({ enabled: true, value: 19 });
  expect(created.generation.thinking).toBeNull();
  expect(created.preferences.argumentsEnabled).toBe(false);
});

it('retains disabled manual values without converting them to active settings', () => {
  const input = record();
  const result = decodeModelConfiguration(input, capabilities);
  expect(result.generation.seed).toEqual({ enabled: false, value: 42 });
  expect(result.generation.responseLength).toEqual({ enabled: false, value: 2048 });
  input.generation.seed.value = 0;
  expect(result.generation.seed.value).toBe(42);
  expect(Object.isFrozen(result.generation.seed)).toBe(true);
});

it.each([
  (value: ReturnType<typeof record>) => ({ ...value, path: 'private' }),
  (value: ReturnType<typeof record>) => ({ ...value, schemaVersion: 2 }),
  (value: ReturnType<typeof record>) => ({ ...value, modelId: '../another' }),
  (value: ReturnType<typeof record>) => ({ ...value, revision: -1 }),
  (value: ReturnType<typeof record>) => ({
    ...value,
    generation: { ...value.generation, temperature: NaN },
  }),
  (value: ReturnType<typeof record>) => ({
    ...value,
    generation: { ...value.generation, topK: 1.2 },
  }),
  (value: ReturnType<typeof record>) => ({
    ...value,
    generation: { ...value.generation, systemPrompt: '\ud800' },
  }),
  (value: ReturnType<typeof record>) => ({
    ...value,
    load: { ...value.load, physicalBatch: 4096 },
  }),
])('rejects malformed, privileged and unsupported records %#', (change) => {
  expect(() => decodeModelConfiguration(change(record()), capabilities)).toThrow(
    'INVALID_CONFIGURATION',
  );
});

it('decodes zero-valued request overrides without accepting load or ownership fields', () => {
  expect(decodeGenerationOverrides({ temperature: 0, seed: 0, top_k: 0 }, capabilities)).toEqual({
    temperature: 0,
    seed: 0,
    top_k: 0,
  });
  for (const input of [
    { contextLength: 4096 },
    { id_slot: 0 },
    { max_tokens: 513 },
    { temperature: Infinity },
    { seed: -1 },
    { top_p: '0.8' },
    { stop: '' },
    { stop: ['a', 'b', 'c', 'd', 'e'] },
    { stop: ['\ud800'] },
    { tools: [] },
    { chat_template_kwargs: { enable_thinking: false } },
  ])
    expect(() => decodeGenerationOverrides(input, capabilities)).toThrow('INVALID_CONFIGURATION');
});
