import { afterEach, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { createOwnedChatTransport } from './chat-transport.js';
import { OwnedSlotMonitor } from './slot-monitor.js';
import { capabilities, record } from '../model-configuration/test-fixtures.js';
import { resolveRequestSettings } from '../model-configuration/resolve.js';
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
  options: {
    speculativeProposer?: boolean;
    malformed?: boolean;
    oversized?: boolean;
    status?: number;
    overflow?: 'stop' | 'rolling' | 'truncate-middle';
    incompatible?: 'render' | 'tokens' | 'empty' | 'schema' | 'oversized';
  } = {},
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
      const body = requests.at(-1)!.body;
      const prefix = body.add_generation_prompt === false;
      res.end(
        req.url === '/apply-template'
          ? options.incompatible === 'oversized'
            ? ' '.repeat(4194305)
            : JSON.stringify({
                prompt: prefix
                  ? options.incompatible === 'empty'
                    ? ''
                    : options.incompatible === 'render'
                      ? 'different'
                      : 'protected'
                  : 'protected suffix',
              })
          : req.url === '/tokenize'
            ? JSON.stringify({
                tokens:
                  options.incompatible === 'schema'
                    ? ['bad']
                    : body.content === 'protected'
                      ? options.incompatible === 'tokens'
                        ? [8, 2]
                        : [1, 2]
                      : [1, 2, 3],
              })
            : req.url?.endsWith('input_tokens')
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
  let owns = true;
  let confirmExit!: () => void;
  const exited = new Promise<void>((resolve) => {
    confirmExit = resolve;
  });
  const monitor = new OwnedSlotMonitor(
    1,
    () => Promise.resolve([{ id: 0, processing: false, task: task || null }]),
    () => owns,
    exited,
    () => {
      cleanup++;
    },
  );
  await monitor.initialize();
  const start = vi.spyOn(monitor, 'start');
  const transport = createOwnedChatTransport({
    speculativeProposer: options.speculativeProposer ?? false,
    port: address.port,
    key: 'test-key',
    alias: 'private-model',
    session: identity,
    owns: () => owns,
    monitor,
    exited,
    configuration: {
      capabilities,
      modelId: record().modelId,
      contextLength: 7680,
      overflow: options.overflow ?? 'stop',
    },
  });
  return {
    transport,
    requests,
    start,
    cleanup: () => cleanup,
    loseListener: () => {
      owns = false;
    },
    confirmExit,
    release: () => {
      task++;
    },
  };
}
it.each([false, true])(
  'binds acceptance visibility to the loaded proposer (%s)',
  async (speculativeProposer) => {
    const f = await fixture({ speculativeProposer });
    const chunks: unknown[] = [];
    const run = f.transport.start(identity, messages, (chunk) => {
      chunks.push(chunk);
    });
    await new Promise<void>((yes) => setTimeout(yes, 150));
    f.release();
    await run.settled;
    expect(JSON.stringify(chunks).includes('"acceptance":null')).toBe(speculativeProposer);
  },
);
it.each(['rolling', 'truncate-middle'] as const)(
  'dispatches %s with a native-counted protected prefix and validates the loaded policy',
  async (overflow) => {
    const f = await fixture({ overflow });
    const source = record();
    const settings = resolveRequestSettings(
      source,
      {
        modelId: source.modelId,
        revision: 1,
        profileId: capabilities.profileId,
        load: source.load,
        preferences: { ...source.preferences, overflow },
      },
      {},
      capabilities,
    );
    const context = [
      { role: 'system' as const, content: 'Instruction' },
      { role: 'user' as const, content: 'First question' },
      { role: 'assistant' as const, content: 'First answer' },
      { role: 'user' as const, content: 'Current question' },
    ];
    const run = f.transport.start(identity, context, () => undefined, settings);
    await new Promise<void>((yes) => setTimeout(yes, 150));
    f.release();
    await run.settled;
    expect(f.requests.map((request) => request.url)).toEqual([
      '/apply-template',
      '/apply-template',
      '/tokenize',
      '/tokenize',
      '/v1/chat/completions',
    ]);
    expect(f.requests[0]!.body.messages).toEqual(context);
    expect(f.requests[1]!.body.messages).toEqual(context.slice(0, overflow === 'rolling' ? 1 : 3));
    expect(f.requests[1]!.body.add_generation_prompt).toBe(false);
    expect(f.requests[2]!.body).toEqual({
      content: 'protected suffix',
      add_special: false,
      parse_special: true,
    });
    expect(f.requests[3]!.body).toEqual({
      content: 'protected',
      add_special: false,
      parse_special: true,
    });
    expect(f.requests[4]!.body).toMatchObject({ messages: context, n_keep: 2, n_discard: 0 });
    expect(f.requests.every((request) => request.auth === 'Bearer test-key')).toBe(true);
    expect(() =>
      f.transport.start(identity, context, () => undefined, { ...settings, overflow: 'stop' }),
    ).toThrow('INVALID_CONTROL');
  },
);
it.each(['render', 'tokens', 'empty', 'schema', 'oversized'] as const)(
  'rejects incompatible protected %s before reserving a native slot',
  async (incompatible) => {
    const f = await fixture({ overflow: 'rolling', incompatible });
    const source = record();
    const settings = resolveRequestSettings(
      source,
      {
        modelId: source.modelId,
        revision: 1,
        profileId: capabilities.profileId,
        load: source.load,
        preferences: { ...source.preferences, overflow: 'rolling' },
      },
      {},
      capabilities,
    );
    const run = f.transport.start(
      identity,
      [{ role: 'system', content: 'Rules' }, ...messages],
      () => undefined,
      settings,
    );
    await expect(run.settled).resolves.toEqual({ status: 'failed', reason: 'INVALID_STREAM' });
    expect(f.start).not.toHaveBeenCalled();
    expect(f.cleanup()).toBe(0);
    expect(f.requests.some((request) => request.url === '/v1/chat/completions')).toBe(false);
  },
);
it('cancels prefix preparation without acquiring or cleaning up a native slot', async () => {
  const f = await fixture({ overflow: 'rolling' });
  const source = record();
  const settings = resolveRequestSettings(
    source,
    {
      modelId: source.modelId,
      revision: 1,
      profileId: capabilities.profileId,
      load: source.load,
      preferences: { ...source.preferences, overflow: 'rolling' },
    },
    {},
    capabilities,
  );
  const run = f.transport.start(
    identity,
    [{ role: 'system', content: 'Rules' }, ...messages],
    () => undefined,
    settings,
  );
  await run.cancel();
  await expect(run.settled).resolves.toEqual({ status: 'cancelled', reason: 'USER_CANCELLED' });
  expect(f.start).not.toHaveBeenCalled();
  expect(f.cleanup()).toBe(0);
  expect(f.requests.some((request) => request.url === '/v1/chat/completions')).toBe(false);
});
it('uses the captured closed settings for template accounting and native generation', async () => {
  const f = await fixture();
  const settings = resolveRequestSettings(
    record(),
    {
      modelId: record().modelId,
      revision: 1,
      profileId: capabilities.profileId,
      load: record().load,
    },
    { temperature: 0.2, max_tokens: 128 },
    capabilities,
  );
  const context = [{ role: 'system' as const, content: 'Instruction' }, ...messages];
  await f.transport.tokenCount(context, new AbortController().signal, settings);
  const run = f.transport.start(identity, context, () => undefined, settings);
  await new Promise<void>((yes) => setTimeout(yes, 150));
  f.release();
  await run.settled;
  expect(f.requests[0]!.body).toEqual({
    model: 'private-model',
    messages: context,
    ...settings.parameters,
  });
  expect(f.requests[1]!.body).toEqual({
    ...f.requests[0]!.body,
    stream: true,
    timings_per_token: true,
    return_progress: true,
    stream_options: { include_usage: true },
    n: 1,
    id_slot: 0,
  });
  expect(() =>
    f.transport.start(identity, context, () => undefined, { ...settings, modelId: 'f'.repeat(64) }),
  ).toThrow('INVALID_CONTROL');
  expect(f.requests).toHaveLength(2);
});

it('sends the unlimited sentinel when the saved reply-length limit is off', async () => {
  const f = await fixture();
  const source = record();
  const settings = resolveRequestSettings(
    source,
    { modelId: source.modelId, revision: 1, profileId: capabilities.profileId, load: source.load },
    {},
    capabilities,
  );
  await f.transport.tokenCount(messages, new AbortController().signal, settings);
  const run = f.transport.start(identity, messages, () => undefined, settings);
  await new Promise<void>((resolve) => setTimeout(resolve, 150));
  f.release();
  await run.settled;
  expect(f.requests.map((request) => request.body.max_tokens)).toEqual([-1, -1]);
});
it('waits for captured engine exit when listener loss rejects slot proof first', async () => {
  const f = await fixture();
  const run = f.transport.start(identity, messages, () => undefined);
  let settled = false;
  const result = run.settled.then(
    (value) => {
      settled = true;
      return value;
    },
    (error: unknown) => {
      settled = true;
      throw error;
    },
  );
  void result.catch(() => undefined);
  try {
    f.loseListener();
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
    expect(f.cleanup()).toBe(1);
    expect(settled).toBe(false);
    f.confirmExit();
    await expect(result).resolves.toEqual({ status: 'interrupted', reason: 'ENGINE_EXITED' });
  } finally {
    f.confirmExit();
  }
});
it('does not turn listener loss without confirmed disposal into an interruption receipt', async () => {
  const f = await fixture();
  const run = f.transport.start(identity, messages, () => undefined);
  f.loseListener();
  const began = Date.now();
  try {
    await expect(run.settled).rejects.toThrow('STATUS_UNCONFIRMED');
    expect(Date.now() - began).toBeGreaterThanOrEqual(5000);
    expect(f.cleanup()).toBe(1);
  } finally {
    f.confirmExit();
  }
}, 10_000);
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
    timings_per_token: true,
    return_progress: true,
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
