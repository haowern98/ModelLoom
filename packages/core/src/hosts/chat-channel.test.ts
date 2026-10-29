import { expect, it, vi } from 'vitest';
import { OwnerChatChannel, UtilityChatTransport } from './chat-channel.js';
import type { TerminalOutcome } from '../generation/contracts.js';
import type { ChatTransport } from '../generation/service.js';
const selection = {
  deploymentId: 'desktop',
  sessionId: 'session',
  operationId: 'load',
  modelId: 'model',
  packageId: 'package',
};
const identity = {
  deploymentId: 'desktop',
  sessionId: 'session',
  operationId: 'load',
  callerId: 'caller',
  requestId: 'request',
  conversationId: 'conversation',
  attemptId: 'attempt',
};
const messages = [{ role: 'user' as const, content: 'test' }];
it('allows native token preparation past the old two-minute IPC limit', async () => {
  vi.useFakeTimers();
  const sent: unknown[] = [];
  const remote = new UtilityChatTransport(selection, (value) => sent.push(value));
  const count = remote.tokenCount(messages, new AbortController().signal);
  const outcome = count.then(
    (value) => ({ value }),
    () => ({ failed: true }),
  );
  try {
    await vi.advanceTimersByTimeAsync(180000);
    expect(sent).toHaveLength(1);
    remote.receive({ type: 'generation-result', id: 1, result: 'count', tokens: 10 });
    expect(await outcome).toEqual({ value: 10 });
  } finally {
    remote.close();
    vi.useRealTimers();
  }
});
it('uses only the matching owner-confirmed engine exit to interrupt pending remote generation', async () => {
  const chunks: unknown[] = [];
  const remote = new UtilityChatTransport(selection, () => undefined);
  const run = remote.start(identity, messages, (chunk) => {
    chunks.push(chunk);
  });
  remote.receive({
    type: 'generation-result',
    id: 1,
    result: 'chunk',
    sequence: 1,
    chunk: { type: 'reasoning', text: 'partial' },
  });
  let settled = false;
  void run.settled.then(() => {
    settled = true;
  });
  remote.engineExited({ ...selection, operationId: 'stale' });
  await Promise.resolve();
  expect(settled).toBe(false);
  remote.engineExited(selection);
  await expect(run.settled).resolves.toEqual({ status: 'interrupted', reason: 'ENGINE_EXITED' });
  expect(chunks).toEqual([{ type: 'reasoning', text: 'partial' }]);
  remote.receive({
    type: 'generation-result',
    id: 1,
    result: 'settled',
    outcome: { status: 'completed', reason: 'STOP' },
  });
  expect(() => remote.start(identity, messages, () => undefined)).toThrow('NOT_READY');
});
it('streams over the inherited channel with one acknowledged chunk and captured settlement', async () => {
  let settle!: (outcome: TerminalOutcome) => void;
  let cancel = 0;
  let progress!: Parameters<ChatTransport['start']>[2];
  const transport: ChatTransport = {
    tokenCount: () => Promise.resolve(10),
    start(_identity, _messages, handler) {
      progress = handler;
      return {
        settled: new Promise((yes) => {
          settle = yes;
        }),
        cancel: () => {
          cancel++;
        },
      };
    },
  };
  const wire: unknown[] = [];
  const owner = new OwnerChatChannel(
    (value) => {
      wire.push(value);
      queueMicrotask(() => remote.receive(value));
    },
    () => ({ selection, transport }),
    () => undefined,
  );
  const remote = new UtilityChatTransport(selection, (value) => {
    queueMicrotask(() => {
      void owner.receive(value);
    });
  });
  expect(await remote.tokenCount(messages, new AbortController().signal)).toBe(10);
  const chunks: unknown[] = [];
  const run = remote.start(identity, messages, (chunk) => {
    chunks.push(chunk);
  });
  await new Promise<void>((yes) => setImmediate(yes));
  await progress({ type: 'reasoning', text: 'Consider' });
  await progress({ type: 'text', text: 'Hello' });
  await progress({ type: 'metrics', speeds: { generation: 12, prefill: 100 } });
  expect(chunks).toEqual([
    { type: 'reasoning', text: 'Consider' },
    { type: 'text', text: 'Hello' },
    { type: 'metrics', speeds: { generation: 12, prefill: 100 } },
  ]);
  const terminal = {
    type: 'terminal' as const,
    outcome: { status: 'completed' as const, reason: 'STOP' as const },
    speeds: { generation: 24.8, prefill: 1420 },
  };
  await progress(terminal);
  expect(chunks.at(-1)).toEqual(terminal);
  await run.cancel();
  expect(cancel).toBe(1);
  let done = false;
  void run.settled.then(() => {
    done = true;
  });
  await new Promise<void>((yes) => setImmediate(yes));
  expect(done).toBe(false);
  settle({ status: 'cancelled', reason: 'USER_CANCELLED' });
  await expect(run.settled).resolves.toEqual({ status: 'cancelled', reason: 'USER_CANCELLED' });
  expect(JSON.stringify(wire)).not.toMatch(/authorization|Bearer|127\.0\.0\.1|id_slot/);
  remote.close();
  owner.close();
});
it('rejects forged fields, wrong-session native work and replayed dispatch', async () => {
  let starts = 0;
  let cleanup = 0;
  const owner = new OwnerChatChannel(
    () => undefined,
    () => ({
      selection,
      transport: {
        tokenCount: () => Promise.resolve(0),
        start() {
          starts++;
          throw new Error('should not run');
        },
      },
    }),
    () => {
      cleanup++;
    },
  );
  await expect(
    owner.receive({
      type: 'generation',
      action: 'start',
      id: 1,
      selection: { ...selection, sessionId: 'wrong' },
      identity,
      messages,
    }),
  ).rejects.toThrow('INVALID_CONTROL');
  await expect(
    owner.receive({
      type: 'generation',
      action: 'count',
      id: 2,
      selection,
      messages,
      url: '/evil',
    }),
  ).rejects.toThrow('INVALID_CONTROL');
  expect(starts).toBe(0);
  expect(cleanup).toBeGreaterThan(0);
  owner.close();
});
it('rejects a chunk that attempts to overwrite its captured identity', async () => {
  const chunks: unknown[] = [];
  const remote = new UtilityChatTransport(selection, () => undefined);
  const run = remote.start(identity, messages, (chunk) => {
    chunks.push(chunk);
  });
  remote.receive({
    type: 'generation-result',
    id: 1,
    result: 'chunk',
    sequence: 1,
    chunk: { type: 'text', text: 'forged', callerId: 'other' },
  });
  await expect(run.settled).rejects.toThrow('EXECUTION_FAILED');
  expect(chunks).toEqual([]);
});
it.each(['text', 'reasoning'] as const)(
  'splits escaped %s into bounded acknowledged envelopes without changing Unicode',
  async (type) => {
    let progress!: Parameters<ChatTransport['start']>[2];
    const wire: { result?: string; sequence?: number; chunk?: { text?: string } }[] = [];
    const owner = new OwnerChatChannel(
      (input) => {
        const value = input as (typeof wire)[number];
        wire.push(value);
        if (value.result === 'chunk')
          queueMicrotask(() => {
            void owner.receive({
              type: 'generation',
              action: 'ack',
              id: 1,
              sequence: value.sequence,
            });
          });
      },
      () => ({
        selection,
        transport: {
          tokenCount: () => Promise.resolve(1),
          start(_id, _messages, callback) {
            progress = callback;
            return { settled: new Promise(() => undefined), cancel: () => undefined };
          },
        },
      }),
      () => undefined,
    );
    await owner.receive({
      type: 'generation',
      action: 'start',
      id: 1,
      selection,
      identity,
      messages,
    });
    const content = '\0'.repeat(12000) + '🙂'.repeat(12000);
    await progress({ type, text: content });
    owner.close();
    expect(wire.every((value) => Buffer.byteLength(JSON.stringify(value)) < 65536)).toBe(true);
    expect(wire.map((value) => value.chunk?.text ?? '').join('')).toBe(content);
  },
);
