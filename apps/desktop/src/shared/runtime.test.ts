import { expect, it } from 'vitest';
import * as runtime from './runtime';

const decode = (value: unknown) => Reflect.get(runtime, 'decodeRuntimeCommand')?.(value);
it('admits removal by exact library identity without accepting paths or deletion options', () => {
  const command = { action: 'remove', modelId: `model-${'a'.repeat(64)}` };
  expect(decode(command)).toEqual(command);
  for (const input of [
    { ...command, path: 'E:/model.gguf' },
    { ...command, deleteFile: true },
    { ...command, modelId: 'model-forged' },
  ])
    expect(() => decode(input)).toThrow('INVALID_CONTROL');
});
it('accepts only a bounded draft reference rather than renderer-provided allocation JSON', () => {
  const command = {
    action: 'load',
    modelId: `model-${'a'.repeat(64)}`,
    draft: { key: `model:${'a'.repeat(64)}`, revision: 2 },
  };
  expect(decode(command)).toEqual(command);
  for (const draft of [
    null,
    {},
    { ...command.draft, revision: 0 },
    { ...command.draft, revision: 1.2 },
    { ...command.draft, key: '../model' },
    { ...command.draft, runs: [] },
  ])
    expect(() => decode({ ...command, draft })).toThrow('INVALID_CONTROL');
});
it('accepts only import, snapshot, stop, and a bounded opaque model ID', () => {
  for (const action of ['import', 'snapshot', 'stop'])
    expect(decode({ action })).toEqual({ action });
  expect(decode({ action: 'load', modelId: 'model-123' })).toEqual({
    action: 'load',
    modelId: 'model-123',
  });
});
it.each([
  null,
  [],
  { action: 'launch', executable: 'anything' },
  { action: 'import', path: 'C:/model.gguf' },
  { action: 'load', modelId: '../file' },
  { action: 'load', modelId: 'a'.repeat(129) },
  { action: 'load', modelId: 'model', configuration: {} },
  { action: 'stop', pid: 12 },
])('rejects privileged fields or malformed data at the renderer boundary: %j', (value) => {
  expect(() => decode(value)).toThrow('INVALID_CONTROL');
});
