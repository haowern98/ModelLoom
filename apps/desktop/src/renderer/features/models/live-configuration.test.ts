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
  editor.numbers.seed = '';
  expect(() => fromModelEditor(editor, source)).toThrow('INVALID_CONFIGURATION');
  expect(editor.numbers.seed).toBe('');
});
