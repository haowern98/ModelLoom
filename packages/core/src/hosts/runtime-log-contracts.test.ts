import { expect, it } from 'vitest';
import { decodeRuntimeLogCommand, decodeRuntimeLogReply } from './runtime-log-contracts.js';

it('accepts only bounded reads and clear without any file or execution authority', () => {
  expect(decodeRuntimeLogCommand({ action: 'read', after: 12 })).toEqual({
    action: 'read',
    after: 12,
  });
  expect(decodeRuntimeLogCommand({ action: 'clear' })).toEqual({ action: 'clear' });
  for (const input of [
    { action: 'read', path: 'secret' },
    { action: 'read', after: -1 },
    { action: 'clear', after: 1 },
    { action: 'execute' },
  ])
    expect(() => decodeRuntimeLogCommand(input)).toThrow('INVALID_CONTROL');
});

it('rejects malformed and oversized log snapshots at the renderer boundary', () => {
  const entry = {
    id: 1,
    at: '2026-10-30T01:00:00.000Z',
    source: 'runtime',
    level: 'error',
    message: 'native.exit code=1',
  };
  expect(decodeRuntimeLogReply({ ok: true, revision: 1, entries: [entry] })).toMatchObject({
    entries: [entry],
  });
  expect(decodeRuntimeLogReply({ ok: true, revision: 1, entries: null })).toMatchObject({
    entries: null,
  });
  for (const entries of [
    [{ ...entry, source: 'shell' }],
    [{ ...entry, message: 'x'.repeat(4097) }],
    [{ ...entry, extra: 'private' }],
    [entry, entry],
    Array.from({ length: 2049 }, (_, i) => ({ ...entry, id: i + 1 })),
    Array.from({ length: 50 }, (_, i) => ({ ...entry, id: i + 1, message: '字'.repeat(4000) })),
  ])
    expect(() => decodeRuntimeLogReply({ ok: true, revision: 9999, entries })).toThrow(
      'INVALID_CONTROL',
    );
});
