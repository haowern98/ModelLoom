import { afterEach, expect, it } from 'vitest';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { checkOwnedReadiness } from './readiness.js';
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          ),
      ),
  );
});
async function server(
  options: {
    wrongModel?: boolean;
    wrongContext?: boolean;
    noAuth?: boolean;
    oversized?: boolean;
    context?: number;
  } = {},
) {
  const server = createServer((request, response) => {
    if (request.headers.authorization !== 'Bearer test-only-key' && !options.noAuth) {
      response.writeHead(401).end();
      return;
    }
    response.setHeader('content-type', 'application/json');
    if (options.oversized) {
      response.end(' '.repeat(65537));
      return;
    }
    response.end(
      JSON.stringify(
        request.url === '/v1/models'
          ? { data: [{ id: options.wrongModel ? 'other' : 'deployment-model' }] }
          : {
              default_generation_settings: {
                n_ctx: options.wrongContext ? 1024 : (options.context ?? 4096),
              },
              total_slots: 2,
            },
      ),
    );
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fixture address');
  return address.port;
}
const probe = (port: number, owner = () => true) =>
  checkOwnedReadiness(
    port,
    'test-only-key',
    'deployment-model',
    4096,
    2,
    owner,
    new AbortController().signal,
  );
it('requires authenticated model and exact effective per-slot context', async () => {
  await expect(probe(await server())).resolves.toBe(4096);
});
it('accepts only the pinned native padding of a requested non-aligned context', async () => {
  const check = (port: number) =>
    checkOwnedReadiness(
      port,
      'test-only-key',
      'deployment-model',
      30246,
      2,
      () => true,
      new AbortController().signal,
    );
  await expect(check(await server({ context: 30464 }))).resolves.toBe(30464);
  for (const context of [30246, 30208, 30720])
    await expect(check(await server({ context }))).rejects.toThrow('CONTEXT_MISMATCH');
});
it.each([{ wrongModel: true }, { wrongContext: true }, { noAuth: true }, { oversized: true }])(
  'rejects mismatched or unauthenticated readiness %j',
  async (options) => {
    await expect(probe(await server(options))).rejects.toThrow(
      'wrongContext' in options ? 'CONTEXT_MISMATCH' : 'NOT_READY',
    );
  },
);
it('refuses a healthy unrelated listener', async () => {
  await expect(probe(await server(), () => false)).rejects.toThrow('NOT_READY');
});
it('rejects loss of ownership between response and acceptance', async () => {
  let checks = 0;
  await expect(probe(await server(), () => ++checks < 3)).rejects.toThrow('NOT_READY');
});
