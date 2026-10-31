import { afterEach, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { readOwnedSlots } from './slot-status.js';
import type { RuntimeDiagnostic } from './runtime-diagnostics.js';

it.each([
  [500, 'private prompt', 'http-status'],
  [200, 'private prompt', 'json'],
] as const)(
  'records safe read metadata for HTTP %s without response text',
  async (status, text, phase) => {
    const server = await fixture(text, status);
    const diagnostic = vi.fn<RuntimeDiagnostic>();
    await expect(
      readOwnedSlots(
        server.port,
        'test-private-key',
        2,
        () => true,
        new AbortController().signal,
        5000,
        diagnostic,
        '11111111-1111-4111-8111-111111111111',
      ),
    ).rejects.toThrow('STATUS_UNCONFIRMED');
    expect(diagnostic).toHaveBeenCalledTimes(1);
    const output = diagnostic.mock.calls[0]![1];
    expect(output).toContain(`"phase":"${phase}"`);
    expect(output).toContain(`"httpStatus":${status}`);
    expect(output).toContain('11111111-1111-4111-8111-111111111111');
    expect(output).not.toContain(text);
    expect(output).not.toContain('test-private-key');
  },
);

const servers: Server[] = [];
it('keeps the same rejection when the diagnostic sink fails', async () => {
  const server = await fixture('private body', 500);
  await expect(
    readOwnedSlots(
      server.port,
      'private-key',
      2,
      () => true,
      new AbortController().signal,
      5000,
      () => {
        throw Error('logging failed');
      },
    ),
  ).rejects.toThrow('STATUS_UNCONFIRMED');
});
it('preserves the transport error code without logging its message or credentials', async () => {
  const server = createServer((request) => request.socket.destroy());
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('FIXTURE');
  const diagnostic = vi.fn<RuntimeDiagnostic>();
  await expect(
    readOwnedSlots(
      address.port,
      'private-key',
      2,
      () => true,
      new AbortController().signal,
      5000,
      diagnostic,
    ),
  ).rejects.toThrow('STATUS_UNCONFIRMED');
  expect(diagnostic.mock.calls[0]![1]).toContain('ECONNRESET');
  expect(diagnostic.mock.calls[0]![1]).toContain('request-error');
  expect(diagnostic.mock.calls[0]![1]).not.toContain('private-key');
});
it('identifies malformed task metadata without retaining native response fields', async () => {
  const server = await fixture(
    JSON.stringify([
      { id: 0, is_processing: true, id_task: 'private native text' },
      { id: 1, is_processing: false },
    ]),
  );
  const diagnostic = vi.fn<RuntimeDiagnostic>();
  await expect(
    readOwnedSlots(
      server.port,
      'private-key',
      2,
      () => true,
      new AbortController().signal,
      5000,
      diagnostic,
    ),
  ).rejects.toThrow('STATUS_UNCONFIRMED');
  const output = diagnostic.mock.calls[0]![1];
  expect(output).toContain('"phase":"slot-task"');
  expect(output).toContain('"slotIndex":0');
  expect(output).not.toContain('private native text');
});
afterEach(async () => {
  vi.useRealTimers();
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
it('allows a remote status response beyond five seconds within the owner deadline', async () => {
  let respond!: () => void;
  const server = createServer((_request, response) => {
    respond = () => response.end(body);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('FIXTURE');
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const result = readOwnedSlots(
    address.port,
    'test-only-key',
    2,
    () => true,
    new AbortController().signal,
    300_000,
  );
  void result.catch(() => undefined);
  while (!respond) await new Promise<void>((resolve) => setImmediate(resolve));
  await vi.advanceTimersByTimeAsync(6000);
  respond();
  await expect(result).resolves.toEqual([
    { id: 0, processing: true, task: 42 },
    { id: 1, processing: false, task: null },
  ]);
});
async function fixture(body: string | Buffer, status = 200, delay = false) {
  let observed: { path: string | undefined; authorization: string | undefined } | undefined;
  const server = createServer((request, response) => {
    observed = { path: request.url, authorization: request.headers.authorization };
    if (!delay) response.writeHead(status).end(body);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('FIXTURE');
  return { port: address.port, observed: () => observed };
}
const body = JSON.stringify([
  { id: 0, is_processing: true, id_task: 42, params: { secret: 'discard' }, prompt: 'discard' },
  { id: 1, is_processing: false },
]);
const read = (port: number, owns = () => true, signal = new AbortController().signal) =>
  readOwnedSlots(port, 'test-only-key', 2, owns, signal);
it('authenticates only fixed GET /slots and projects no native text or settings', async () => {
  const server = await fixture(body);
  expect(await read(server.port)).toEqual([
    { id: 0, processing: true, task: 42 },
    { id: 1, processing: false, task: null },
  ]);
  expect(server.observed()).toEqual({ path: '/slots', authorization: 'Bearer test-only-key' });
});
it.each([
  '[]',
  '[{"id":0,"is_processing":false},{"id":0,"is_processing":false}]',
  '[{"id":0,"is_processing":true},{"id":1,"is_processing":false}]',
  '[{"id":0,"is_processing":false,"id_task":-1},{"id":1,"is_processing":false}]',
  '[{"id":2,"is_processing":false},{"id":1,"is_processing":false}]',
  ' '.repeat(1048577),
  Buffer.from([0xff]),
])('rejects malformed, changed or oversized status without raw diagnostics', async (value) => {
  const server = await fixture(value);
  await expect(read(server.port)).rejects.toThrow('STATUS_UNCONFIRMED');
});
it.each([301, 401, 500])('rejects HTTP %i without redirect or retry', async (status) => {
  const server = await fixture(body, status);
  await expect(read(server.port)).rejects.toThrow('STATUS_UNCONFIRMED');
});
it('checks captured listener before request and after response', async () => {
  const server = await fixture(body);
  await expect(read(server.port, () => false)).rejects.toThrow('STATUS_UNCONFIRMED');
  expect(server.observed()).toBeUndefined();
  let checks = 0;
  await expect(read(server.port, () => ++checks === 1)).rejects.toThrow('STATUS_UNCONFIRMED');
});
it('aborts a hung response without accepting partial status', async () => {
  const server = await fixture(body, 200, true);
  const abort = new AbortController();
  const result = read(server.port, () => true, abort.signal);
  const failed = expect(result).rejects.toThrow('STATUS_UNCONFIRMED');
  abort.abort();
  await failed;
});
it('enforces an absolute five-second deadline on a hung response', async () => {
  const server = await fixture(body, 200, true);
  const start = Date.now();
  await expect(read(server.port)).rejects.toThrow('STATUS_UNCONFIRMED');
  expect(Date.now() - start).toBeLessThan(6000);
}, 7000);
