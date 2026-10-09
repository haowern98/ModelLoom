import { afterEach, expect, it } from 'vitest';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { readOwnedSlots } from './slot-status.js';

const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
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
