import { expect, it } from 'vitest';
import { realEngineAdapter } from './real-engine.js';
import { fixedArguments } from './runtime-arguments.js';
import type { RuntimeConfiguration } from '../runtime/preflight.js';
const config: RuntimeConfiguration = {
  modelSha256: 'a'.repeat(64),
  contextPerSlot: 4096,
  slots: 2,
  gpuLayers: 0,
  cacheK: 'f16',
  cacheV: 'f16',
  seed: 7,
  temperature: 0.8,
};
it('rejects a caller-generated install receipt before accessing a model or launching', () => {
  expect(() =>
    realEngineAdapter(
      { packageId: 'anything', directory: 'C:/user-controlled' },
      'C:/user-controlled/model.gguf',
      config,
      9999,
    ),
  ).toThrow('UNVERIFIED_PACKAGE');
});
it('builds fixed arguments with auto-fit, agent and Web UI disabled and a private key path', () => {
  const args = fixedArguments(
    'C:/models/exact.gguf',
    config,
    9999,
    'C:/private/key',
    'deployment-model',
  );
  expect(args).toContain('--no-ui');
  expect(args).toContain('--no-agent');
  expect(args).toContain('--no-ui-mcp-proxy');
  expect(args.slice(args.indexOf('--fit'), args.indexOf('--fit') + 2)).toEqual(['--fit', 'off']);
  expect(args.slice(args.indexOf('--ctx-size'), args.indexOf('--ctx-size') + 2)).toEqual([
    '--ctx-size',
    '8192',
  ]);
  expect(args.slice(args.indexOf('--temp'), args.indexOf('--temp') + 2)).toEqual(['--temp', '0.8']);
  expect(args.slice(args.indexOf('--host'), args.indexOf('--host') + 2)).toEqual([
    '--host',
    '127.0.0.1',
  ]);
  expect(args).not.toContain('--api-key');
  expect(args).not.toContain('--hf-repo');
});
it('refuses extra configuration instead of silently dropping unsupported settings', () => {
  expect(() =>
    fixedArguments('model.gguf', { ...config, executable: 'evil.exe' }, 9999, 'key', 'alias'),
  ).toThrow('INVALID_CONFIGURATION');
});
