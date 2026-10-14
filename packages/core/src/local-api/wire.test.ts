import { expect, it } from 'vitest';
import {
  decodeApiManagementCommand,
  decodeApiOwnerCommand,
  decodeApiManagementReply,
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
