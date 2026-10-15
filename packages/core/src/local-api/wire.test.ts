import { expect, it } from 'vitest';
import {
  decodeApiManagementCommand,
  decodeApiOwnerCommand,
  decodeApiManagementReply,
  decodeApiOwnerReply,
} from './wire.js';
it('separates public UI management from main-only verified import registration', () => {
  expect(decodeApiManagementCommand({ action: 'start' })).toEqual({ action: 'start' });
  const imported = { action: 'registerImport', modelId: 'a'.repeat(64), created: 123 };
  expect(() => decodeApiManagementCommand(imported)).toThrow('INVALID_CONTROL');
  expect(decodeApiOwnerCommand(imported)).toEqual(imported);
  for (const input of [
    { action: 'start', port: 1234 },
    { action: 'revealKey', path: 'private' },
    { action: 'registerImport', modelId: '../secret', created: 123 },
  ])
    expect(() => decodeApiOwnerCommand(input)).toThrow('INVALID_CONTROL');
});

it('keeps saved file locations confined to the main/core owner protocol', () => {
  const source = {
    modelId: 'a'.repeat(64),
    file: 'E:\\Models\\model.gguf',
    name: 'Indexed model',
    size: '4 GB',
    sizeBytes: 4000000000,
    modifiedMs: 1234,
    architecture: 'llama',
    contextLimit: 4096,
    quantization: 'Q4_K_M',
    parameters: '4B',
  };
  const command = { action: 'registerImport', modelId: source.modelId, created: 123, source };
  expect(decodeApiOwnerCommand(command)).toEqual(command);
  expect(() => decodeApiManagementCommand(command)).toThrow('INVALID_CONTROL');
  expect(decodeApiOwnerCommand({ action: 'readImportSource' })).toEqual({
    action: 'readImportSource',
  });
  expect(() => decodeApiManagementCommand({ action: 'readImportSource' })).toThrow(
    'INVALID_CONTROL',
  );
  expect(decodeApiOwnerReply({ ok: true, source }, { action: 'readImportSource' })).toEqual({
    ok: true,
    source,
  });
  expect(() => decodeApiManagementReply({ ok: true, source })).toThrow('INVALID_CONTROL');
  expect(() =>
    decodeApiOwnerCommand({ ...command, source: { ...source, file: '../secret' } }),
  ).toThrow();
  expect(() =>
    decodeApiOwnerCommand({ ...command, source: { ...source, modelId: 'b'.repeat(64) } }),
  ).toThrow();
});
it('allows transient secret delivery only for an explicit reveal or private main Copy transfer', () => {
  const status = {
    phase: 'stopped',
    configuredPort: 8000,
    address: null,
    model: null,
    uptimeMs: null,
    requests: 0,
    responseTimeMs: null,
    logs: [],
    error: null,
    keyPresent: true,
    keyGeneration: 1,
  };
  const revealed = { ok: true, status, secret: `ml_${'a'.repeat(64)}` };
  expect(() => decodeApiManagementReply(revealed)).toThrow('INVALID_CONTROL');
  expect(decodeApiManagementReply(revealed, true)).toEqual(revealed);
  expect(() => decodeApiManagementReply({ ok: false, error: 'private exception' })).toThrow(
    'INVALID_CONTROL',
  );
  expect(() =>
    decodeApiManagementReply({ ok: true, status: { ...status, logs: ['Bearer private key'] } }),
  ).toThrow('INVALID_CONTROL');
});
