import { expect, it } from 'vitest';
import {
  decodeApiManagementCommand,
  decodeApiOwnerCommand,
  decodeApiManagementReply,
  decodeApiOwnerReply,
} from './wire.js';

it('keeps entry removal owner-only and rejects arbitrary paths and extra fields', () => {
  const command = { action: 'removeImport' as const, modelId: 'a'.repeat(64) };
  expect(decodeApiOwnerCommand(command)).toEqual(command);
  expect(() => decodeApiManagementCommand(command)).toThrow('INVALID_CONTROL');
  expect(decodeApiOwnerReply({ ok: true, removed: true }, command)).toEqual({
    ok: true,
    removed: true,
  });
  for (const input of [
    { ...command, modelId: '../model' },
    { ...command, file: 'E:/model.gguf' },
  ])
    expect(() => decodeApiOwnerCommand(input)).toThrow('INVALID_CONTROL');
});

it('keeps paged library restoration owner-only and validates cursor progress and entry data', () => {
  const source = {
    modelId: 'b'.repeat(64),
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
  const command = { action: 'readLibraryEntry' as const, after: 'a'.repeat(64) };
  for (const after of [null, command.after]) {
    const request = { ...command, after };
    expect(decodeApiOwnerCommand(request)).toEqual(request);
    expect(() => decodeApiManagementCommand(request)).toThrow('INVALID_CONTROL');
    for (const lastUsedAt of [null, 123]) {
      const reply = { ok: true, entry: { source, lastUsedAt } };
      expect(decodeApiOwnerReply(reply, request)).toEqual(reply);
      expect(() => decodeApiManagementReply(reply)).toThrow('INVALID_CONTROL');
    }
    expect(decodeApiOwnerReply({ ok: true, entry: null }, request)).toEqual({
      ok: true,
      entry: null,
    });
  }
  for (const after of [undefined, '', '../secret', 'A'.repeat(64), 'a'.repeat(63), 123])
    expect(() => decodeApiOwnerCommand({ ...command, after })).toThrow('INVALID_CONTROL');
  expect(() => decodeApiOwnerCommand({ ...command, file: 'private' })).toThrow('INVALID_CONTROL');
  for (const modelId of ['a'.repeat(64), '0'.repeat(64)])
    expect(() =>
      decodeApiOwnerReply(
        { ok: true, entry: { source: { ...source, modelId }, lastUsedAt: null } },
        command,
      ),
    ).toThrow('INVALID_CONTROL');
  for (const lastUsedAt of [
    0,
    -1,
    1.5,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
    '123',
    undefined,
  ])
    expect(() => decodeApiOwnerReply({ ok: true, entry: { source, lastUsedAt } }, command)).toThrow(
      'INVALID_CONTROL',
    );
  for (const reply of [
    { ok: true, entry: null, extra: true },
    { ok: true, entry: { source, lastUsedAt: null, extra: true } },
    { ok: true, entry: { source: { ...source, extra: true }, lastUsedAt: null } },
  ])
    expect(() => decodeApiOwnerReply(reply, command)).toThrow();
});

it('reads usage through the fixed owner only and rejects forged or malformed timestamps', () => {
  const command = { action: 'readModelUsage' as const };
  expect(decodeApiOwnerCommand(command)).toEqual(command);
  expect(() => decodeApiManagementCommand(command)).toThrow('INVALID_CONTROL');
  expect(() => decodeApiOwnerCommand({ ...command, modelId: 'a'.repeat(64) })).toThrow(
    'INVALID_CONTROL',
  );
  for (const lastUsedAt of [null, 123456789])
    expect(decodeApiOwnerReply({ ok: true, lastUsedAt }, command)).toEqual({
      ok: true,
      lastUsedAt,
    });
  for (const lastUsedAt of [0, -1, 1.5, NaN, Infinity, '123'])
    expect(() => decodeApiOwnerReply({ ok: true, lastUsedAt }, command)).toThrow('INVALID_CONTROL');
  expect(() => decodeApiManagementReply({ ok: true, lastUsedAt: 123 })).toThrow('INVALID_CONTROL');
});
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
