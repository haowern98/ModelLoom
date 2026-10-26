import { PassThrough } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { expect, it } from 'vitest';
import { readPeerBody } from './peer-body.js';

function message(
  payload: string,
  complete = true,
  length: string | undefined = String(Buffer.byteLength(payload)),
) {
  return Object.assign(new PassThrough(), {
    complete,
    headers: length === undefined ? {} : { 'content-length': length },
  }) as unknown as IncomingMessage & PassThrough;
}
const premature = () =>
  Object.assign(Error('Premature close'), { code: 'ERR_STREAM_PREMATURE_CLOSE' });

it('accepts every framed byte when normal transport teardown races the end event', async () => {
  const payload = '{"phase":"approved","name":"电脑"}';
  const input = message(payload);
  const result = readPeerBody(input);
  const bytes = Buffer.from(payload);
  input.push(bytes.subarray(0, 7));
  input.push(bytes.subarray(7));
  input.destroy(premature());
  expect(await result).toEqual({ phase: 'approved', name: '电脑' });
});

it.each([
  ['incomplete HTTP message', false, '{"ok":true}', '11', premature()],
  ['missing trailing bytes', true, '{"ok":true}', '20', premature()],
  ['missing framing length', true, '{"ok":true}', undefined, premature()],
  [
    'other transport error',
    true,
    '{"ok":true}',
    '11',
    Object.assign(Error('Reset'), { code: 'ECONNRESET' }),
  ],
  ['invalid JSON', true, '{"ok":truX}', '11', premature()],
] as const)(
  'rejects %s despite transport teardown',
  async (_name, complete, payload, length, error) => {
    const input = message(payload, complete, length);
    // An explicitly missing header must stay missing rather than use the fixture default.
    if (length === undefined) input.headers = {};
    const rejected = expect(readPeerBody(input)).rejects.toBeDefined();
    input.push(Buffer.from(payload));
    input.destroy(error);
    await rejected;
  },
);

it('accepts an ordinary complete chunked body without requiring a length header', async () => {
  const input = message('{"ok":true}');
  input.headers = { 'transfer-encoding': 'chunked' };
  const result = readPeerBody(input);
  input.end('{"ok":true}');
  expect(await result).toEqual({ ok: true });
});

it('bounds the body before parsing and closes an oversized input', async () => {
  const payload = '"' + 'a'.repeat(16384) + '"';
  const input = message(payload);
  const rejected = expect(readPeerBody(input)).rejects.toThrow('PEER_MESSAGE_TOO_LARGE');
  input.end(payload);
  await rejected;
  expect(input.destroyed).toBe(true);
});

it.each(['', '-1', '11x', ['11', '11'], '20000'])(
  'rejects malformed or oversized framing %j before reading',
  async (length) => {
    const input = message('{}');
    Reflect.set(input.headers, 'content-length', length);
    await expect(readPeerBody(input)).rejects.toBeDefined();
    expect(input.destroyed).toBe(true);
  },
);
