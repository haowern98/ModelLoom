import { describe, expect, it } from 'vitest';
import {
  decodeSend,
  decodeRequestIdentity,
  decodeProgress,
  GENERATION_LIMITS,
} from './contracts.js';

const identity = {
  deploymentId: 'desktop',
  sessionId: 'session',
  operationId: 'load',
  requestId: 'request',
  callerId: 'caller',
  conversationId: 'conversation',
  attemptId: 'attempt',
};

describe('generation contracts', () => {
  it('accepts bounded live metrics without granting extra fields', () => {
    const event = {
      ...identity,
      sequence: 1,
      type: 'metrics',
      speeds: { generation: 12, prefill: null },
    };
    expect(decodeProgress(JSON.stringify(event))).toEqual(event);
    expect(() => decodeProgress(JSON.stringify({ ...event, url: 'forged' }))).toThrow(
      'INVALID_CONTROL',
    );
    expect(() =>
      decodeProgress(JSON.stringify({ ...event, speeds: { generation: -1, prefill: null } })),
    ).toThrow('INVALID_CONTROL');
  });
  it('accepts only the two scalar measured rates on a terminal event', () => {
    const event = {
      ...identity,
      sequence: 1,
      type: 'terminal',
      outcome: { status: 'completed', reason: 'STOP' },
      speeds: { generation: 24.8, prefill: null },
    };
    expect(decodeProgress(JSON.stringify(event))).toEqual(event);
    for (const speeds of [
      { generation: 'secret', prefill: 1 },
      { generation: 0, prefill: 1 },
      { generation: -1, prefill: 1 },
      { generation: 1e100, prefill: 1 },
      { generation: 1, prefill: 1, endpoint: 'forged' },
      { generation: 1 },
    ])
      expect(() => decodeProgress(JSON.stringify({ ...event, speeds }))).toThrow('INVALID_CONTROL');
  });
  it('copies a valid send without trimming its actual prompt', () => {
    const input = { conversationId: 'conversation', text: '  Hello 界 👋  ' };
    const output = decodeSend(input);
    expect(output).toEqual(input);
    expect(output).not.toBe(input);
    expect(Object.isFrozen(output)).toBe(true);
  });
  it.each([
    null,
    [],
    {},
    { conversationId: 'conversation', text: ' ' },
    { conversationId: 'conversation', text: 'x'.repeat(12_001) },
    { conversationId: '../other', text: 'hello' },
    { conversationId: 'constructor', text: 'hello' },
    { conversationId: 'conversation', text: 'hello', callerId: 'forged' },
    { conversationId: 'conversation', text: 'hello', tools: [] },
    { conversationId: 'conversation', text: [{ type: 'image_url', url: 'file:///secret' }] },
    { conversationId: 'conversation', text: '\ud800' },
  ])('rejects invalid send variant %# without echoing input', (input) => {
    expect(() => decodeSend(input)).toThrow(/^INVALID_CONTROL$/u);
  });
  it('accepts the existing composer character ceiling with multibyte text', () => {
    expect(decodeSend({ conversationId: 'conversation', text: '界'.repeat(12_000) })).toEqual({
      conversationId: 'conversation',
      text: '界'.repeat(12_000),
    });
  });
  it('copies only a complete internal request identity', () => {
    expect(decodeRequestIdentity(identity)).toEqual(identity);
    expect(Object.isFrozen(decodeRequestIdentity(identity))).toBe(true);
  });
  it.each(['', '../escape', 'has space', '__proto__', 'x'.repeat(129)])(
    'rejects unusable internal session IDs: %s',
    (sessionId) => {
      expect(() => decodeRequestIdentity({ ...identity, sessionId })).toThrow('INVALID_CONTROL');
    },
  );
  it('rejects extra authority fields and incomplete identities', () => {
    expect(() => decodeRequestIdentity({ ...identity, port: 8080 })).toThrow('INVALID_CONTROL');
    expect(() => decodeRequestIdentity({ requestId: 'request' })).toThrow('INVALID_CONTROL');
  });
  it('validates bounded UTF-8 progress including its entire envelope', () => {
    const event = { type: 'text', ...identity, sequence: 1, text: '' };
    const room = GENERATION_LIMITS.maxEventBytes - Buffer.byteLength(JSON.stringify(event));
    const exact = { ...event, text: 'x'.repeat(room) };
    expect(decodeProgress(JSON.stringify(exact))).toEqual(exact);
    expect(() => decodeProgress(JSON.stringify({ ...exact, text: exact.text + 'x' }))).toThrow(
      'INVALID_CONTROL',
    );
    expect(() => decodeProgress(JSON.stringify({ ...event, text: '界'.repeat(22_000) }))).toThrow(
      'INVALID_CONTROL',
    );
  });
  it('validates thinking through the same exact-key, Unicode and envelope bounds', () => {
    const event = { type: 'reasoning', ...identity, sequence: 1, text: '界👋' };
    expect(decodeProgress(JSON.stringify(event))).toEqual(event);
    for (const invalid of [
      { ...event, text: '\ud800' },
      { ...event, text: 'x'.repeat(GENERATION_LIMITS.maxEventBytes) },
      { ...event, endpoint: 'forged' },
    ])
      expect(() => decodeProgress(JSON.stringify(invalid))).toThrow('INVALID_CONTROL');
  });
  it.each([
    '{',
    JSON.stringify({ type: 'text', ...identity, sequence: -1, text: 'secret' }),
    JSON.stringify({ type: 'text', ...identity, sequence: 1.5, text: 'secret' }),
    JSON.stringify({
      type: 'text',
      ...identity,
      sequence: 1,
      text: 'secret',
      credentials: 'secret',
    }),
    JSON.stringify({ type: 'terminal', ...identity, sequence: 1, outcome: { status: 'complete' } }),
    JSON.stringify({
      type: 'terminal',
      ...identity,
      sequence: 1,
      outcome: { status: 'failed', reason: 'secret' },
    }),
  ])('rejects malformed progress variant %#', (input) => {
    expect(() => decodeProgress(input)).toThrow(/^INVALID_CONTROL$/u);
  });
  it('accepts explicit complete and output-limit terminal categories', () => {
    for (const outcome of [
      { status: 'completed', reason: 'STOP' },
      { status: 'limit-reached', reason: 'OUTPUT_LIMIT' },
    ]) {
      const event = { type: 'terminal', ...identity, sequence: 2, outcome };
      expect(decodeProgress(JSON.stringify(event))).toEqual(event);
    }
  });
});
