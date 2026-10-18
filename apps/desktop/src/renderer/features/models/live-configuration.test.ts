import { expect, it } from 'vitest';
import { toModelEditor, fromModelEditor } from './live-configuration';
import { record } from '../../../../../../packages/core/src/model-configuration/test-fixtures';

it('round-trips real defaults without replacing disabled values or automatic threads', () => {
  const source = record();
  source.generation.temperature = 0.23;
  source.preferences.argumentsText = '--example $(ignored)';
  const editor = toModelEditor(source);
  expect(editor.numbers.temperature).toBe('0.23');
  expect(editor.numbers.threads).toBe('');
  expect(editor.enabled.seed).toBe(false);
  expect(fromModelEditor(editor, source)).toEqual(source);
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
  expect(fromModelEditor(editor, source)).toEqual(source);
});
