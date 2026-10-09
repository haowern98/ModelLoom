import { expect, it } from 'vitest';
import { decodeChatReply } from './chat-wire.js';
it.each([
  { ok: true, page: { payload: '{}', next: null, revision: 0, path: 'secret' } },
  { ok: true, page: { payload: '{}', next: null, revision: -1 } },
  { ok: true, requestId: '../other' },
  { ok: false, error: 'arbitrary private native details' },
  { ok: false, error: 'NOT_READY', conversationId: 'chat' },
  { ok: true, page: { payload: 'x'.repeat(65536), next: null, revision: 0 } },
])('rejects malformed or overprivileged Chat replies %j', (input) => {
  expect(() => decodeChatReply(input)).toThrow('INVALID_CONTROL');
});
it('accepts only the closed success and error reply shapes', () => {
  for (const value of [
    { ok: true },
    { ok: true, conversationId: 'chat' },
    { ok: true, conversationId: 'chat', requestId: 'request' },
    { ok: true, page: { payload: '{}', next: null, revision: 0 } },
    { ok: false, error: 'NOT_READY' },
  ])
    expect(decodeChatReply(value)).toEqual(value);
});
