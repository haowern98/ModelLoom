import { expect, it } from 'vitest';
import { decodeModelConfiguration } from './contracts.js';
import { resolveRequestSettings } from './resolve.js';
import { capabilities, record } from './test-fixtures.js';

function active() {
  return {
    modelId: record().modelId,
    revision: 1,
    profileId: capabilities.profileId,
    load: record().load,
  };
}

it('resolves one request override over committed defaults without saving or changing another request', () => {
  const committed = decodeModelConfiguration(record(), capabilities);
  const first = resolveRequestSettings(
    committed,
    active(),
    { temperature: 0, seed: 42 },
    capabilities,
  );
  const second = resolveRequestSettings(committed, active(), {}, capabilities);
  expect(first.parameters.temperature).toBe(0);
  expect(first.parameters.seed).toBe(42);
  expect(second.parameters.temperature).toBe(0.8);
  expect(second.parameters.seed).toBe(4294967295);
  expect(second.parameters.max_tokens).toBe(-1);
  expect(committed.generation.seed.enabled).toBe(false);
  expect(Object.isFrozen(first.parameters)).toBe(true);
});

it('disables the output cap independently of the stored manual limit and active context size', () => {
  const source = record();
  source.generation.responseLength.value = 123;
  expect(resolveRequestSettings(source, active(), {}, capabilities).parameters.max_tokens).toBe(-1);
  source.generation.responseLength.enabled = true;
  expect(resolveRequestSettings(source, active(), {}, capabilities).parameters.max_tokens).toBe(
    123,
  );
  expect(
    resolveRequestSettings(source, active(), { max_tokens: 64 }, capabilities).parameters
      .max_tokens,
  ).toBe(64);
});

it('turns disabled filters off and requests a random seed as Bionic checkboxes do', () => {
  const source = record();
  source.generation.topP.enabled = false;
  source.generation.minP.enabled = false;
  source.generation.repeatPenalty.value = 1.9;
  source.generation.presencePenalty.value = 1.5;
  const result = resolveRequestSettings(source, active(), {}, capabilities);
  expect(result.parameters).toMatchObject({
    top_p: 1,
    min_p: 0,
    repeat_penalty: 1,
    presence_penalty: 0,
    seed: 4294967295,
  });
  expect(source.generation.topP.value).toBe(0.95);
  expect(source.generation.seed.value).toBe(42);
});

it('captures revisions and keeps active load settings while newer defaults are pending', () => {
  const source = record();
  source.load.contextLength = 4096;
  const captured = resolveRequestSettings(source, active(), {}, capabilities);
  source.revision = 4;
  source.generation.temperature = 0.2;
  expect(captured.activeLoadRevision).toBe(1);
  expect(captured.generationRevision).toBe(3);
  expect(captured.parameters.temperature).toBe(0.8);
  expect(captured.contextLength).toBe(7680);
});

it('rejects unsupported budgets, mismatched models/profiles and unsupported thinking changes', () => {
  const source = record();
  source.generation.responseLength.enabled = true;
  expect(() => resolveRequestSettings(source, active(), {}, capabilities)).toThrow(
    'INVALID_CONFIGURATION',
  );
  expect(() =>
    resolveRequestSettings(record(), { ...active(), modelId: 'b'.repeat(64) }, {}, capabilities),
  ).toThrow('INVALID_CONFIGURATION');
  expect(() =>
    resolveRequestSettings(record(), { ...active(), profileId: 'other' }, {}, capabilities),
  ).toThrow('INVALID_CONFIGURATION');
  expect(() =>
    resolveRequestSettings(
      { ...record(), generation: { ...record().generation, thinking: false } },
      active(),
      {},
      capabilities,
    ),
  ).toThrow('UNSUPPORTED_SETTING');
});

it('allows a larger explicit budget only under a capability that actually supports it', () => {
  const supported = { ...capabilities, maxOutputTokens: 1024 };
  expect(
    resolveRequestSettings(record(), active(), { max_tokens: 1024 }, supported).parameters
      .max_tokens,
  ).toBe(1024);
  expect(() =>
    resolveRequestSettings(record(), active(), { max_tokens: 1024 }, capabilities),
  ).toThrow('INVALID_CONFIGURATION');
});
