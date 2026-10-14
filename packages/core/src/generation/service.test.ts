import { afterEach, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { HistoryStore } from '../history/store.js';
import type { Provenance } from '../history/store.js';
import { GenerationService } from './service.js';
import type { ChatMessage, ChatTransport } from './service.js';
import type {
  GenerationChunk,
  ProgressEvent,
  RequestIdentity,
  TerminalOutcome,
} from './contracts.js';
const provenance: Provenance = {
  packageId: 'runtime1',
  upstreamCommit: 'a'.repeat(40),
  configuration: {
    modelSha256: 'b'.repeat(64),
    contextPerSlot: 7680,
    slots: 4,
    gpuLayers: 99,
    cacheK: 'q8_0',
    cacheV: 'q8_0',
    seed: 7,
    temperature: 0.8,
  },
};
const services: GenerationService[] = [],
  stores: HistoryStore[] = [];
afterEach(async () => {
  for (const s of services.splice(0)) await s.close();
  for (const s of stores.splice(0)) s.close();
  vi.useRealTimers();
});
function setup(tokens = 10, unconfirmed = false, count?: ChatTransport['tokenCount']) {
  const store = new HistoryStore(new DatabaseSync(':memory:'));
  stores.push(store);
  const executions: {
    identity: RequestIdentity;
    messages: readonly ChatMessage[];
    emit: (chunk: GenerationChunk) => void;
    finish: (outcome: TerminalOutcome) => void;
    cancelled: boolean;
  }[] = [];
  let cleanupCount = 0;
  const transport: ChatTransport = {
    tokenCount: count ?? (() => Promise.resolve(tokens)),
    start(identity, messages, emit) {
      if ('kind' in identity) throw new Error('Unexpected stateless execution in Chat fixture');
      let finish!: (value: TerminalOutcome) => void;
      const settled = new Promise<TerminalOutcome>((resolve) => {
        finish = resolve;
      });
      const entry = { identity, messages, emit, finish, cancelled: false };
      executions.push(entry);
      return {
        settled,
        cancel() {
          entry.cancelled = true;
          if (!unconfirmed) finish({ status: 'cancelled', reason: 'USER_CANCELLED' });
        },
      };
    },
  };
  const service = new GenerationService({
    session: { deploymentId: 'desktop', sessionId: 'session', operationId: 'operation' },
    provenance,
    history: store,
    transport,
    cleanup: () => {
      cleanupCount++;
      return Promise.resolve();
    },
  });
  services.push(service);
  return { service, store, executions, cleanupCount: () => cleanupCount };
}
async function drain() {
  for (let i = 0; i < 25; i++) await Promise.resolve();
}
it('cancels caller-owned preparation without native work or changing another chat', async () => {
  let counting: AbortSignal | undefined;
  const { service, store, executions } = setup(10, false, (_messages, signal) => {
    counting = signal;
    return new Promise(() => undefined);
  });
  const c = await store.newConversation();
  await store.saveDraft(c.id, 'Unsent question');
  const sending = service.send('window1', { conversationId: c.id, text: 'Unsent question' });
  const rejected = sending.then(
    () => 'started',
    (error: Error) => error.message,
  );
  await drain();
  await expect(service.cancelConversation('intruder', c.id)).rejects.toThrow('DENIED');
  expect(counting?.aborted).toBe(false);
  await service.cancelConversation('window1', c.id);
  expect(await rejected).toBe('NOT_READY');
  expect(counting?.aborted).toBe(true);
  expect(executions).toHaveLength(0);
  expect(await store.readConversation(c.id)).toMatchObject({ draft: 'Unsent question', turns: [] });
});
it('conversation Stop cancels only its caller-owned active request', async () => {
  const { service, store, executions } = setup();
  const a = await store.newConversation(),
    b = await store.newConversation();
  await service.send('window1', { conversationId: a.id, text: 'Stop this' });
  await service.send('window1', { conversationId: b.id, text: 'Keep running' });
  await drain();
  await expect(service.cancelConversation('intruder', a.id)).rejects.toThrow('DENIED');
  await service.cancelConversation('window1', a.id);
  await drain();
  expect((await store.readConversation(a.id)).turns[0]?.attempts[0]?.state).toBe('cancelled');
  expect(executions[1]?.cancelled).toBe(false);
  await service.cancelConversation('window1', a.id);
});
it('waits for the chosen response to settle before deleting, without cancelling another chat', async () => {
  const { service, store, executions } = setup(10, true);
  const removed = await store.newConversation(),
    kept = await store.newConversation();
  await service.send('window1', { conversationId: removed.id, text: 'Remove' });
  await service.send('window1', { conversationId: kept.id, text: 'Keep' });
  await drain();
  let deleted = false;
  const deleting = service.deleteConversation('window1', removed.id).then(() => {
    deleted = true;
  });
  await drain();
  expect(executions[0]?.cancelled).toBe(true);
  expect(executions[1]?.cancelled).toBe(false);
  expect(deleted).toBe(false);
  await expect(
    service.send('window1', { conversationId: removed.id, text: 'Race' }),
  ).rejects.toThrow('CONVERSATION_BUSY');
  expect((await store.readConversation(removed.id)).turns).toHaveLength(1);
  executions[0]!.finish({ status: 'cancelled', reason: 'USER_CANCELLED' });
  await deleting;
  await expect(store.readConversation(removed.id)).rejects.toThrow('UNKNOWN_CONVERSATION');
  expect((await store.readConversation(kept.id)).turns).toHaveLength(1);
  await service.cancel('window1', executions[1]!.identity.requestId);
  executions[1]!.finish({ status: 'cancelled', reason: 'USER_CANCELLED' });
});
it('aborts prompt preparation for deletion before creating native work', async () => {
  const { service, store, executions } = setup(
    10,
    false,
    (_messages, signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      }),
  );
  const c = await store.newConversation();
  const sending = service.send('window1', { conversationId: c.id, text: 'Preparing' });
  const rejected = expect(sending).rejects.toThrow('NOT_READY');
  await drain();
  await service.deleteConversation('window1', c.id);
  await rejected;
  expect(executions).toHaveLength(0);
  await expect(store.readConversation(c.id)).rejects.toThrow('UNKNOWN_CONVERSATION');
});
it('preserves history on unconfirmed cancellation and refuses deletion by another caller', async () => {
  vi.useFakeTimers();
  const { service, store, executions } = setup(10, true);
  const c = await store.newConversation();
  await service.send('window1', { conversationId: c.id, text: 'Keep if unsafe' });
  await drain();
  await expect(service.deleteConversation('intruder', c.id)).rejects.toThrow('DENIED');
  expect(executions[0]?.cancelled).toBe(false);
  const deleting = service.deleteConversation('window1', c.id).then(
    () => 'deleted',
    (error: Error) => error.message,
  );
  await drain();
  await vi.advanceTimersByTimeAsync(5000);
  expect(await deleting).toBe('NOT_READY');
  expect((await store.readConversation(c.id)).turns[0]?.attempts[0]?.state).toBe('failed');
});
it('measures thinking on a monotonic clock, finishes at the first answer and retains it on Stop', async () => {
  const clock = vi.spyOn(performance, 'now').mockReturnValue(1000);
  try {
    const { service, store, executions } = setup(),
      c = await store.newConversation();
    const first = await service.send('window1', { conversationId: c.id, text: 'question' });
    await drain();
    executions[0]!.emit({ type: 'reasoning', text: 'Consider' });
    clock.mockReturnValue(13500);
    executions[0]!.emit({ type: 'text', text: 'Answer' });
    await drain();
    expect((await store.readConversation(c.id)).turns[0]?.attempts[0]?.thinkingMs).toBe(12500);
    clock.mockReturnValue(50000);
    await service.cancel('window1', first.requestId);
    await drain();
    expect((await store.readConversation(c.id)).turns[0]?.attempts[0]).toMatchObject({
      thinkingMs: 12500,
      state: 'cancelled',
    });
    await service.send('window1', { conversationId: c.id, text: 'second' });
    await drain();
    executions[1]!.emit({ type: 'reasoning', text: 'Partial thinking' });
    clock.mockReturnValue(52000);
    await service.cancel('window1', executions[1]!.identity.requestId);
    await drain();
    expect((await store.readConversation(c.id)).turns[1]?.attempts[0]).toMatchObject({
      thinkingMs: 2000,
      state: 'cancelled',
    });
  } finally {
    clock.mockRestore();
  }
});
it('persists an attempt before starting captured transport and commits terminal output before publishing it', async () => {
  const { service, store, executions } = setup(),
    c = await store.newConversation(),
    events: ProgressEvent[] = [];
  service.subscribe((event) => {
    events.push(event);
    return true;
  });
  const identity = await service.send('window1', { conversationId: c.id, text: 'question' });
  await drain();
  expect((await store.readConversation(c.id)).turns[0]?.attempts[0]?.id).toBe(identity.attemptId);
  expect(executions).toHaveLength(1);
  executions[0]!.emit({ type: 'text', text: 'answer' });
  const speeds = { generation: 24.8, prefill: 1420 };
  executions[0]!.emit({
    type: 'terminal',
    outcome: { status: 'completed', reason: 'STOP' },
    speeds,
  });
  expect(events.some((event) => event.type === 'terminal')).toBe(false);
  executions[0]!.finish({ status: 'completed', reason: 'STOP' });
  await drain();
  expect((await store.readConversation(c.id)).turns[0]?.attempts[0]).toMatchObject({
    text: 'answer',
    state: 'completed',
    speeds,
  });
  expect(events.at(-1)).toMatchObject({
    type: 'terminal',
    outcome: { status: 'completed', reason: 'STOP' },
    speeds,
  });
});
it('does not execute or create a turn when context exceeds the selected configuration', async () => {
  const { service, store, executions } = setup(7169),
    c = await store.newConversation();
  await expect(service.send('window1', { conversationId: c.id, text: 'question' })).rejects.toThrow(
    'CONTEXT_FULL',
  );
  expect(executions).toHaveLength(0);
  expect((await store.readConversation(c.id)).turns).toHaveLength(0);
});
it('denies concurrent sends in one conversation before another user turn is stored', async () => {
  const { service, store } = setup(),
    c = await store.newConversation();
  const first = service.send('window1', { conversationId: c.id, text: 'question' });
  await expect(
    service.send('window1', { conversationId: c.id, text: 'duplicate' }),
  ).rejects.toThrow('CONVERSATION_BUSY');
  await first;
  expect((await store.readConversation(c.id)).turns).toHaveLength(1);
});
it('never launches when the history transaction fails', async () => {
  const { service, store, executions } = setup(),
    c = await store.newConversation();
  store.close();
  await expect(service.send('window1', { conversationId: c.id, text: 'question' })).rejects.toThrow(
    'HISTORY_UNAVAILABLE',
  );
  expect(executions).toHaveLength(0);
});
it('binds cancellation to the captured caller and preserves partial output', async () => {
  const { service, store, executions } = setup(),
    c = await store.newConversation();
  const identity = await service.send('window1', { conversationId: c.id, text: 'question' });
  await drain();
  executions[0]!.emit({ type: 'text', text: 'partial' });
  executions[0]!.emit({ type: 'reasoning', text: 'partial thinking' });
  await expect(service.cancel('window2', identity.requestId)).rejects.toThrow('DENIED');
  expect(executions[0]?.cancelled).toBe(false);
  await service.cancel('window1', identity.requestId);
  await drain();
  expect((await store.readConversation(c.id)).turns[0]?.attempts[0]).toMatchObject({
    state: 'cancelled',
    text: 'partial',
    reasoning: 'partial thinking',
  });
});
it('stores thinking separately and passes completed thinking through the unchanged chat template', async () => {
  const { service, store, executions } = setup(),
    c = await store.newConversation();
  const events: ProgressEvent[] = [];
  service.subscribe((event) => {
    events.push(event);
    return true;
  });
  await service.send('window1', { conversationId: c.id, text: 'first' });
  await drain();
  executions[0]!.emit({ type: 'reasoning', text: 'consider' });
  executions[0]!.emit({ type: 'text', text: 'answer' });
  const outcome = { status: 'completed', reason: 'STOP' } as const;
  executions[0]!.emit({ type: 'terminal', outcome });
  executions[0]!.finish(outcome);
  await drain();
  expect((await store.readConversation(c.id)).turns[0]?.attempts[0]).toMatchObject({
    text: 'answer',
    reasoning: 'consider',
    state: 'completed',
  });
  expect(events[0]).toMatchObject({ type: 'reasoning', text: 'consider' });
  await service.send('window1', { conversationId: c.id, text: 'second' });
  await drain();
  expect(executions[1]?.messages).toEqual([
    { role: 'user', content: 'first' },
    { role: 'assistant', content: 'answer', reasoning_content: 'consider' },
    { role: 'user', content: 'second' },
  ]);
});
it('retry appends an attempt and sends only completed context with the original user turn', async () => {
  const { service, store, executions } = setup(),
    c = await store.newConversation(),
    first = await service.send('window1', { conversationId: c.id, text: 'question' });
  await drain();
  executions[0]!.emit({ type: 'text', text: 'partial' });
  await service.cancel('window1', first.requestId);
  await drain();
  await service.retry('window1', first.attemptId);
  await drain();
  expect((await store.readConversation(c.id)).turns).toHaveLength(1);
  expect((await store.readConversation(c.id)).turns[0]?.attempts).toHaveLength(2);
  expect(executions[1]?.messages).toEqual([{ role: 'user', content: 'question' }]);
});
it('bounds reservations before asynchronous preparation and starts only four requests', async () => {
  const { service, store, executions } = setup();
  const conversations = [];
  for (let i = 0; i < 13; i++) conversations.push(await store.newConversation());
  const pending = conversations
    .slice(0, 12)
    .map((c) => service.send('window1', { conversationId: c.id, text: 'question' }));
  await expect(
    service.send('window1', { conversationId: conversations[12]!.id, text: 'overflow' }),
  ).rejects.toThrow('QUEUE_FULL');
  await Promise.all(pending);
  await drain();
  expect(executions).toHaveLength(4);
  expect((await store.readConversation(conversations[12]!.id)).turns).toHaveLength(0);
});
it('a slow observer cannot build an event backlog or stop persistence', async () => {
  const { service, store, executions } = setup(),
    c = await store.newConversation();
  const events: ProgressEvent[] = [];
  service.subscribe((event) => {
    events.push(event);
    return false;
  });
  await service.send('window1', { conversationId: c.id, text: 'question' });
  await drain();
  executions[0]!.emit({ type: 'text', text: 'one' });
  executions[0]!.emit({ type: 'text', text: 'two' });
  executions[0]!.finish({ status: 'completed', reason: 'STOP' });
  await drain();
  expect(events).toHaveLength(1);
  expect((await store.readConversation(c.id)).turns[0]?.attempts[0]?.text).toBe('onetwo');
});
it('checkpoints partial text on the reviewed timer while generation remains active', async () => {
  vi.useFakeTimers();
  const { service, store, executions } = setup(),
    c = await store.newConversation();
  await service.send('window1', { conversationId: c.id, text: 'question' });
  await drain();
  executions[0]!.emit({ type: 'text', text: 'partial' });
  await vi.advanceTimersByTimeAsync(250);
  expect((await store.readConversation(c.id)).turns[0]?.attempts[0]).toMatchObject({
    text: 'partial',
    state: 'running',
  });
});
it('closing rejects new work and interrupts stored active attempts without replay', async () => {
  const { service, store } = setup(),
    c = await store.newConversation();
  await service.send('window1', { conversationId: c.id, text: 'question' });
  await drain();
  await service.close();
  await expect(service.send('window1', { conversationId: c.id, text: 'late' })).rejects.toThrow(
    'NOT_READY',
  );
  expect((await store.readConversation(c.id)).turns[0]?.attempts[0]?.state).toBe('interrupted');
});
it('Quit waits for in-flight history preparation and records its interruption before releasing storage', async () => {
  const { service, store } = setup(),
    c = await store.newConversation();
  const original = store.beginTurn.bind(store);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  store.beginTurn = async (input) => {
    await gate;
    return original(input);
  };
  const pending = service.send('window1', { conversationId: c.id, text: 'question' });
  await drain();
  let closed = false;
  const closing = service.close().then(() => {
    closed = true;
  });
  await drain();
  expect(closed).toBe(false);
  release();
  await expect(pending).rejects.toThrow('NOT_READY');
  await closing;
  expect((await store.readConversation(c.id)).turns[0]?.attempts[0]?.state).toBe('interrupted');
});
it('retry finds a stored attempt beyond the first page of conversation summaries', async () => {
  const { service, store } = setup(),
    c = await store.newConversation();
  await store.beginTurn({
    conversationId: c.id,
    turnId: 'oldturn',
    attemptId: 'oldattempt',
    requestId: 'oldrequest',
    text: 'old question',
    provenance,
  });
  await store.finish('oldattempt', 'partial', { status: 'cancelled', reason: 'USER_CANCELLED' });
  for (let i = 0; i < 34; i++) await store.newConversation();
  await expect(service.retry('window1', 'oldattempt')).resolves.toMatchObject({
    conversationId: c.id,
  });
});
it('unconfirmed native cancellation closes admission, preserves its failure and triggers owned cleanup once', async () => {
  vi.useFakeTimers();
  const { service, store, executions, cleanupCount } = setup(10, true),
    c = await store.newConversation();
  await service.send('window1', { conversationId: c.id, text: 'question' });
  await drain();
  executions[0]!.emit({ type: 'text', text: 'partial' });
  executions[0]!.emit({ type: 'terminal', outcome: { status: 'completed', reason: 'STOP' } });
  executions[0]!.emit({ type: 'text', text: 'invalid late output' });
  await vi.advanceTimersByTimeAsync(5000);
  await drain();
  expect((await store.readConversation(c.id)).turns[0]?.attempts[0]).toMatchObject({
    text: 'partial',
    state: 'failed',
    outcome: { reason: 'CANCEL_UNCONFIRMED' },
  });
  expect(cleanupCount()).toBe(1);
  const another = await store.newConversation();
  await expect(
    service.send('window1', { conversationId: another.id, text: 'blocked' }),
  ).rejects.toThrow('NOT_READY');
});
