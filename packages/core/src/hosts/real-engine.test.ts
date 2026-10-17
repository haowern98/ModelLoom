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
  expect(args).toContain('--slots');
  expect(args).toContain('--no-context-shift');
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
it('enables bounded prompt caching and checkpoints by default for CPU and CUDA', () => {
  for (const selected of [
    config,
    { ...config, gpuLayers: 48, gpuDevice: 'GPU-22c23971-dacf-2123-2169-ad70d8f6729a' },
  ]) {
    const args = fixedArguments('model.gguf', selected, 9999, 'key', 'alias');
    for (const [flag, value] of [
      ['--cache-ram', '768'],
      ['--ctx-checkpoints', '2'],
    ] as const)
      expect(args.slice(args.indexOf(flag), args.indexOf(flag) + 2)).toEqual([flag, value]);
  }
});
it('disables implicit GPU selection for a CPU configuration', () => {
  const args = fixedArguments('model.gguf', config, 9999, 'key', 'alias');
  expect(args.slice(args.indexOf('--device'), args.indexOf('--device') + 2)).toEqual([
    '--device',
    'none',
  ]);
});
it('binds explicit single-GPU offload to visible CUDA0 without changing model settings', () => {
  const selected = {
    ...config,
    gpuLayers: 48,
    gpuDevice: 'GPU-22c23971-dacf-2123-2169-ad70d8f6729a',
  };
  const args = fixedArguments('model.gguf', selected, 9999, 'key', 'alias');
  for (const [flag, value] of [
    ['--device', 'CUDA0'],
    ['--split-mode', 'none'],
    ['--main-gpu', '0'],
    ['--n-gpu-layers', '48'],
  ] as const)
    expect(args.slice(args.indexOf(flag), args.indexOf(flag) + 2)).toEqual([flag, value]);
  expect(args).not.toContain(selected.gpuDevice);
});
it('uses the tested flash attention setting for quantized CUDA value cache', () => {
  const args = fixedArguments(
    'model.gguf',
    {
      ...config,
      gpuLayers: 48,
      gpuDevice: 'GPU-22c23971-dacf-2123-2169-ad70d8f6729a',
      cacheK: 'q8_0',
      cacheV: 'q8_0',
    },
    9999,
    'key',
    'alias',
  );
  expect(args.slice(args.indexOf('--flash-attn'), args.indexOf('--flash-attn') + 2)).toEqual([
    '--flash-attn',
    'on',
  ]);
});
it.each([
  { ...config, gpuLayers: 48 },
  { ...config, gpuLayers: 48, gpuDevice: 'GPU-22c23971' },
  { ...config, gpuLayers: 48, gpuDevice: '0' },
  { ...config, gpuLayers: 48, gpuDevice: 'GPU-22c23971-dacf-2123-2169-ad70d8f6729a,1' },
  { ...config, gpuDevice: 'GPU-22c23971-dacf-2123-2169-ad70d8f6729a' },
])('refuses missing, ambiguous or CPU-inconsistent GPU placement', (selected) => {
  expect(() => fixedArguments('model.gguf', selected, 9999, 'key', 'alias')).toThrow(
    'INVALID_CONFIGURATION',
  );
});
