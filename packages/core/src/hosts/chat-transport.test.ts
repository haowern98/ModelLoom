import { afterEach, expect, it } from 'vitest';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { createOwnedChatTransport } from './chat-transport.js';
import { OwnedSlotMonitor } from './slot-monitor.js';
import type { GenerationChunk } from '../generation/contracts.js';

const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((yes) => server.close(() => yes()));
  }
});
const identity = {
  deploymentId: 'desktop',
  sessionId: 'session',
  operationId: 'load',
  callerId: 'window',
  conversationId: 'chat',
  requestId: 'request',
  attemptId: 'attempt',
};
const messages = [{ role: 'user' as const, content: 'Hello' }];
const terminal =
  'data: ' +
  JSON.stringify({
    id: 'completion',
    model: 'private-model',
    object: 'chat.completion.chunk',
    created: 1,
    choices: [{ index: 0, delta: { content: 'Hello' }, finish_reason: null }],
  }) +
  '\n\ndata: ' +
  JSON.stringify({
    id: 'completion',
    model: 'private-model',
    object: 'chat.completion.chunk',
    created: 1,
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
  }) +
  '\n\ndata: [DONE]\n\n';
async function fixture(
  options: { malformed?: boolean; oversized?: boolean; status?: number } = {},
) {
  const requests: { url: string; auth: string | undefined; body: Record<string, unknown> }[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      requests.push({
        url: req.url!,
        auth: req.headers.authorization,
        body: JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>,
      });
      res.writeHead(options.status ?? 200);
      res.end(
        req.url?.endsWith('input_tokens')
          ? options.oversized
            ? ' '.repeat(65537)
            : '{"input_tokens":9,"object":"response.input_tokens"}'
          : options.malformed
            ? 'data: broken\n\n'
            : terminal,
      );
    });
  });
  servers.push(server);
  await new Promise<void>((yes) => server.listen(0, '127.0.0.1', yes));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('FIXTURE');
  let task = 0;
  let cleanup = 0;
  const monitor = new OwnedSlotMonitor(
    1,
    () => Promise.resolve([{ id: 0, processing: false, task: task || null }]),
    () => true,
    new Promise(() => undefined),
    () => {
      cleanup++;
    },
  );
  await monitor.initialize();
  const transport = createOwnedChatTransport({
    port: address.port,
    key: 'test-key',
    alias: 'private-model',
    session: identity,
    owns: () => true,
    monitor,
  });
  return {
    transport,
    requests,
    cleanup: () => cleanup,
    release: () => {
      task++;
    },
  };
}
it('counts with the matching Chat template endpoint and no sampling overrides', async () => {
  const f = await fixture();
  expect(await f.transport.tokenCount(messages, new AbortController().signal)).toBe(9);
  expect(f.requests).toEqual([
    {
      url: '/v1/chat/completions/input_tokens',
      auth: 'Bearer test-key',
      body: { model: 'private-model', messages },
    },
  ]);
});
it('passes prior assistant thinking separately to the selected template and rejects forged user thinking', async () => {
  const f = await fixture();
  const context = [
    ...messages,
    { role: 'assistant' as const, content: 'Answer', reasoning_content: 'Thinking' },
  ];
  await f.transport.tokenCount(context, new AbortController().signal);
  expect(f.requests[0]?.body).toEqual({ model: 'private-model', messages: context });
  await expect(
    f.transport.tokenCount(
      [{ role: 'user', content: 'Question', reasoning_content: 'forged' }],
      new AbortController().signal,
    ),
  ).rejects.toThrow('TOKEN_COUNT_FAILED');
  expect(f.requests).toHaveLength(1);
});
it('streams text but fulfills completion only after native release confirmation', async () => {
  const f = await fixture();
  const chunks: GenerationChunk[] = [];
  const run = f.transport.start(identity, messages, (chunk) => {
    chunks.push(chunk);
  });
  let settled = false;
  void run.settled.then(() => {
    settled = true;
  });
  await new Promise<void>((yes) => setTimeout(yes, 150));
  expect(chunks).toEqual([
    { type: 'text', text: 'Hello' },
    { type: 'terminal', outcome: { status: 'completed', reason: 'STOP' } },
  ]);
  expect(settled).toBe(false);
  f.release();
  await expect(run.settled).resolves.toEqual({ status: 'completed', reason: 'STOP' });
  expect(f.requests[0]?.body).toEqual({
    model: 'private-model',
    messages,
    stream: true,
    max_tokens: 512,
    n: 1,
    id_slot: 0,
  });
});
it('rejects stale sessions and oversized requests before native dispatch', async () => {
  const f = await fixture();
  expect(() =>
    f.transport.start({ ...identity, sessionId: 'old' }, messages, () => undefined),
  ).toThrow('NOT_READY');
  expect(() =>
    f.transport.start(identity, [{ role: 'user', content: 'x'.repeat(1048576) }], () => undefined),
  ).toThrow('INVALID_CONTROL');
  expect(f.requests).toEqual([]);
});
it.each([{ oversized: true }, { status: 302 }, { status: 401 }])(
  'rejects failed/bounded token accounting %j',
  async (options) => {
    const f = await fixture(options);
    await expect(f.transport.tokenCount(messages, new AbortController().signal)).rejects.toThrow(
      'TOKEN_COUNT_FAILED',
    );
  },
);
