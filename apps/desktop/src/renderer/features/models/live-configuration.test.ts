import { expect, it } from 'vitest';
import { toModelEditor, fromModelEditor } from './live-configuration';
import { record } from '../../../../../../packages/core/src/model-configuration/test-fixtures';
import { speculationOff } from '../../../../../../packages/core/src/speculative-decoding/contracts';
import type { ModelConfigurationRecord } from '../../../shared/model-configuration';

it('retains disabled saved companion intent without activating it', () => {
  const source: ModelConfigurationRecord = {
    ...record(),
    schemaVersion: 2,
    speculation: {
      version: 1,
      enabled: false,
      proposer: { method: 'mtp', source: { kind: 'embedded' }, maxDraftTokens: 3 },
      retrieval: { method: 'ngram-simple' },
    },
  };
  const editor = toModelEditor(source);
  expect(editor.speculation.method).toBe('off');
  expect(fromModelEditor(editor, source).speculation).toEqual(source.speculation);
});

it('saves typed speculative intent and restores its companion and native token default', () => {
  const source = record();
  const editor = toModelEditor(source);
  editor.speculation = {
    method: 'dflash',
    source: 'a'.repeat(64),
    maxDraftTokens: '',
    retrieval: 'ngram-simple',
  };
  const result = fromModelEditor(editor, source);
  expect(result.schemaVersion).toBe(2);
  expect(result.speculation).toEqual({
    version: 1,
    enabled: true,
    proposer: {
      method: 'dflash',
      source: { kind: 'asset', modelId: 'a'.repeat(64) },
      maxDraftTokens: null,
    },
    retrieval: { method: 'ngram-simple' },
  });
  expect(toModelEditor(result).speculation).toEqual(editor.speculation);
  editor.speculation.source = '';
  expect(() => fromModelEditor(editor, source)).toThrow('INVALID_CONFIGURATION');
  editor.speculation.source = 'a'.repeat(64);
  editor.speculation.maxDraftTokens = '257';
  expect(() => fromModelEditor(editor, source)).toThrow('INVALID_CONFIGURATION');
});

it('round-trips real defaults without replacing disabled values or automatic threads', () => {
  const source = record();
  source.generation.temperature = 0.23;
  source.preferences.argumentsText = '--example $(ignored)';
  const editor = toModelEditor(source);
  expect(editor.numbers.temperature).toBe('0.23');
  expect(editor.numbers.threads).toBe('');
  expect(editor.enabled.seed).toBe(false);
  expect(fromModelEditor(editor, source)).toEqual({
    ...source,
    schemaVersion: 2,
    speculation: speculationOff(),
  });
});

it('retains empty or invalid pending text instead of committing invented numeric zeros', () => {
  const source = record(),
    editor = toModelEditor(source);
  editor.enabled.seed = true;
  editor.numbers.seed = '';
  expect(() => fromModelEditor(editor, source)).toThrow('INVALID_CONFIGURATION');
  expect(editor.numbers.seed).toBe('');
});

it('preserves committed values for disabled invalid drafts while saving enabled changes', () => {
  const source = record();
  const editor = toModelEditor(source);
  editor.numbers.seed = '';
  editor.numbers.ropeBase = '-1';
  editor.numbers.temperature = '0.4';
  const result = fromModelEditor(editor, source);
  expect(result.generation.seed).toEqual(source.generation.seed);
  expect(result.preferences.ropeBase).toEqual(source.preferences.ropeBase);
  expect(result.generation.temperature).toBe(0.4);
  expect(result.load.threads).toBeNull();
  expect(editor.numbers.seed).toBe('');
});

it.each([
  ['repeatPenalty', '101'],
  ['responseLength', '2147483648'],
  ['reasoningBudget', '2147483648'],
  ['ropeBase', '1000000000001'],
  ['ropeScale', '1000001'],
] as const)('retains committed inactive %s beyond the core bounds', (field, raw) => {
  const source = record();
  const editor = toModelEditor(source);
  editor.enabled[field] = false;
  editor.numbers[field] = raw;
  expect(fromModelEditor(editor, source)).toEqual({
    ...source,
    schemaVersion: 2,
    speculation: speculationOff(),
  });
});
it('turns off the neural proposer when enabling retrieval alone', () => {
  const source = {
    ...record(),
    schemaVersion: 2 as const,
    speculation: {
      version: 1 as const,
      enabled: true,
      proposer: {
        method: 'mtp' as const,
        source: { kind: 'embedded' as const },
        maxDraftTokens: 3,
      },
      retrieval: null,
    },
  };
  const editor = toModelEditor(source);
  editor.speculation.method = 'off';
  editor.speculation.retrieval = 'ngram-simple';
  expect(fromModelEditor(editor, source).speculation).toEqual({
    version: 1,
    enabled: true,
    proposer: null,
    retrieval: { method: 'ngram-simple' },
  });
});
