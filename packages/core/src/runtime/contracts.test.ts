import { describe, expect, it } from 'vitest';
import { decodeEvent, MAX_CONTROL_BYTES } from './contracts.js';
const id = { deploymentId: 'd1', sessionId: 's1', operationId: 'op1' };
const selection = { ...id, packageId: 'p1', modelId: 'm1' };
describe('control validation', () => {
  it.each(['{', 'null', '[]', '1', '"x"', '{}'])(
    'rejects malformed or non-event JSON: %s',
    (input) => {
      expect(() => decodeEvent(input)).toThrow('INVALID_CONTROL');
    },
  );
  it.each([
    { type: 'unknown', ...id },
    { type: 'ready', ...id, sessionId: 3 },
    { type: 'ready', deploymentId: 'd1' },
    { type: 'ready', ...id, executable: 'C:/untrusted.exe' },
    { type: 'start', selection: { ...selection, path: 'bad' } },
    { type: 'failed', ...id, fault: { code: 'bad', message: 'private' } },
    { type: 'failed', ...id, fault: { code: 'START_FAILED', message: 5 } },
    { type: 'text', ...id, requestId: 'r1', text: false },
    { type: 'text', ...id, requestId: 'r1' },
    { type: 'request-completed', ...id, requestId: 'r1', extra: true },
  ])('rejects invalid variant %#', (event) =>
    expect(() => decodeEvent(JSON.stringify(event))).toThrow('INVALID_CONTROL'),
  );
  it.each(['', 'has space', '../escape', 'a'.repeat(129), '__proto__', 'prototype', 'constructor'])(
    'rejects invalid IDs: %s',
    (sessionId) => {
      expect(() => decodeEvent(JSON.stringify({ type: 'ready', ...id, sessionId }))).toThrow(
        'INVALID_CONTROL',
      );
      expect(() =>
        decodeEvent(JSON.stringify({ type: 'text', ...id, requestId: sessionId, text: '' })),
      ).toThrow('INVALID_CONTROL');
    },
  );
  it('bounds UTF-8 bytes rather than characters', () => {
    const input = JSON.stringify({
      type: 'text',
      ...id,
      requestId: 'r1',
      text: '界'.repeat(Math.floor(MAX_CONTROL_BYTES / 3)),
    });
    expect(() => decodeEvent(input)).toThrow('INVALID_CONTROL');
  });
  it('accepts exactly the byte bound and rejects one byte more', () => {
    const event = { type: 'text', ...id, requestId: 'r1', text: '' };
    const remaining = MAX_CONTROL_BYTES - Buffer.byteLength(JSON.stringify(event), 'utf8');
    const text = 'x'.repeat(remaining);
    expect(decodeEvent(JSON.stringify({ ...event, text }))).toEqual({ ...event, text });
    expect(() => decodeEvent(JSON.stringify({ ...event, text: text + 'x' }))).toThrow(
      'INVALID_CONTROL',
    );
  });
  it.each([
    { type: 'start', selection },
    ...['spawned', 'ready', 'stopping', 'stopped'].map((type) => ({ type, ...id })),
    { type: 'failed', ...id, fault: { code: 'ENGINE_EXITED', message: 'Owned engine exited' } },
    { type: 'request-started', ...id, requestId: 'r1' },
    { type: 'text', ...id, requestId: 'r1', text: 'hello' },
    { type: 'request-completed', ...id, requestId: 'r1' },
  ])('copies accepted variant %#', (event) => {
    const accepted = decodeEvent(JSON.stringify(event));
    expect(accepted).toEqual(event);
    expect(accepted).not.toBe(event);
  });
  it('does not disclose rejected input in errors', () => {
    expect(() => decodeEvent(JSON.stringify({ type: 'private model data' }))).toThrow(
      /^INVALID_CONTROL$/,
    );
  });
});
