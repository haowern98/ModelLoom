import { expect, it } from 'vitest';
import { createApiManagementHandler } from './api-management';
import type { ApiManagementReply, ApiManagementStatus } from '../shared/local-api';
const status: ApiManagementStatus = {
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
const secret = `ml_${'c'.repeat(64)}`;
it('rejects other windows and subframes before any key operation', async () => {
  const sender = {},
    frame = {};
  let calls = 0;
  const handler = createApiManagementHandler({
    sender,
    frame: () => frame,
    closing: () => false,
    command: () => {
      calls++;
      return Promise.resolve({ ok: true, status, secret });
    },
    copy: () => Promise.resolve(),
  });
  for (const event of [
    { sender: {}, senderFrame: frame },
    { sender, senderFrame: {} },
    { sender, senderFrame: null },
  ])
    await expect(handler(event, { action: 'revealKey' })).rejects.toThrow('INVALID_CONTROL');
  expect(calls).toBe(0);
  await expect(
    handler(
      { sender, senderFrame: frame },
      { action: 'registerImport', modelId: 'a'.repeat(64), created: 123 },
    ),
  ).rejects.toThrow('INVALID_CONTROL');
});
it('copies only in main and revalidates the frame before releasing a transient secret', async () => {
  const sender = {},
    original = {};
  let frame = original,
    copied = '';
  const handler = createApiManagementHandler({
    sender,
    frame: () => frame,
    closing: () => false,
    command: () => Promise.resolve({ ok: true, status, secret }),
    copy: (value) => {
      copied = value;
      return Promise.resolve();
    },
  });
  expect(await handler({ sender, senderFrame: original }, { action: 'copyKey' })).toEqual({
    ok: true,
    status,
  });
  expect(copied).toBe(secret);
  expect(await handler({ sender, senderFrame: original }, { action: 'revealKey' })).toEqual({
    ok: true,
    status,
    secret,
  });
  let release!: (reply: ApiManagementReply) => void;
  const pending = createApiManagementHandler({
    sender,
    frame: () => frame,
    closing: () => false,
    command: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
    copy: () => Promise.resolve(),
  })({ sender, senderFrame: original }, { action: 'revealKey' });
  frame = {};
  release({ ok: true, status, secret });
  await expect(pending).rejects.toThrow('INVALID_CONTROL');
});
it('sanitizes clipboard failures without returning the key or exception text', async () => {
  const sender = {},
    frame = {};
  const handler = createApiManagementHandler({
    sender,
    frame: () => frame,
    closing: () => false,
    command: () => Promise.resolve({ ok: true, status, secret }),
    copy: () => Promise.reject(new Error(`private ${secret}`)),
  });
  expect(await handler({ sender, senderFrame: frame }, { action: 'copyKey' })).toEqual({
    ok: false,
    error: 'API_UNAVAILABLE',
  });
});
