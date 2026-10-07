import { expect, it } from 'vitest';
import * as runtime from './runtime';

const decode = (value: unknown) => Reflect.get(runtime, 'decodeRuntimeCommand')?.(value);
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
