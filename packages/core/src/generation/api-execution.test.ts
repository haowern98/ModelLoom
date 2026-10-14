import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { GenerationService } from './service.js';
import { ApiCallerScope } from './api-authority.js';
import type { ApiCaller } from './api-authority.js';
import type { GenerationChunk, ExecutionIdentity, TerminalOutcome } from './contracts.js';
import { HistoryStore } from '../history/store.js';
import { capabilities, record } from '../model-configuration/test-fixtures.js';
import { resolveRequestSettings } from '../model-configuration/resolve.js';
import { OwnerChatChannel, UtilityChatTransport } from '../hosts/chat-channel.js';

it('runs stateless API on the Chat queue, revokes queued callers and never writes API history', async () => {
  const history = new HistoryStore(new DatabaseSync(':memory:'));
  const scope = new ApiCallerScope();
  const runs: {
    identity: ExecutionIdentity;
    emit: (chunk: GenerationChunk) => void | Promise<void>;
    finish: (outcome: TerminalOutcome) => void;
  }[] = [];
  const active = {
    modelId: record().modelId,
    revision: 1,
    profileId: capabilities.profileId,
    load: record().load,
  };
  const service = new GenerationService({
    history,
    session: { deploymentId: 'desktop', sessionId: 'session', operationId: 'load' },
    provenance: {
      packageId: 'runtime',
      upstreamCommit: 'a'.repeat(40),
      configuration: {
        modelSha256: record().modelId,
        contextPerSlot: 7680,
        slots: 4,
        gpuLayers: 0,
        cacheK: 'f16',
        cacheV: 'f16',
        seed: 7,
        temperature: 0.8,
      },
    },
    configuration: {
      capabilities,
      capture: (overrides = {}) =>
        Promise.resolve(resolveRequestSettings(record(), active, overrides, capabilities)),
    },
    cleanup: () => Promise.resolve(),
    transport: {
      tokenCount: () => Promise.resolve(10),
      start: (identity, _messages, emit) => {
        let finish!: (outcome: TerminalOutcome) => void;
        const settled = new Promise<TerminalOutcome>((resolve) => {
          finish = resolve;
        });
        runs.push({ identity, emit, finish });
        return { settled, cancel: () => finish({ status: 'cancelled', reason: 'USER_CANCELLED' }) };
      },
    },
  });
  try {
    const c = await history.newConversation();
    const chat = await service.send('window', { conversationId: c.id, text: 'Saved chat' });
    const before = await history.readConversation(c.id);
    const api = service.generateApi(
      scope.issue(),
      { messages: [{ role: 'user', content: 'Stateless' }], overrides: { temperature: 0.2 } },
      () => Promise.resolve(),
    );
    for (let i = 0; i < 30; i++) await Promise.resolve();
    expect(runs).toHaveLength(2);
    expect(runs[1]!.identity).toMatchObject({ kind: 'api' });
    expect(runs[1]!.identity).not.toHaveProperty('conversationId');
    await runs[1]!.emit({ type: 'reasoning', text: 'Thinking' });
    await runs[1]!.emit({
      type: 'terminal',
      outcome: { status: 'limit-reached', reason: 'OUTPUT_LIMIT' },
      usage: { prompt_tokens: 10, completion_tokens: 512, total_tokens: 522 },
    });
    runs[1]!.finish({ status: 'limit-reached', reason: 'OUTPUT_LIMIT' });
    expect(await api.done).toMatchObject({
      text: '',
      reasoning: 'Thinking',
      outcome: { status: 'limit-reached' },
      usage: { completion_tokens: 512 },
    });
    expect(await history.readConversation(c.id)).toEqual(before);
    expect((await history.listConversations()).length).toBe(1);
    await expect(
      service.generateApi(
        {} as ApiCaller,
        { messages: [{ role: 'user', content: 'Forged' }], overrides: {} },
        () => undefined,
      ).done,
    ).rejects.toThrow('DENIED');
    const pending = Array.from({ length: 4 }, () =>
      service.generateApi(
        scope.issue(),
        { messages: [{ role: 'user', content: 'Queued' }], overrides: {} },
        () => undefined,
      ),
    );
    for (let i = 0; i < 30; i++) await Promise.resolve();
    expect(runs).toHaveLength(5);
    scope.close();
    runs[2]!.finish({ status: 'cancelled', reason: 'USER_CANCELLED' });
    expect((await pending[3]!.done).outcome.status).toBe('failed');
    expect(runs).toHaveLength(5);
    for (const task of pending) task.cancel();
    await Promise.all(pending.map((task) => task.done));
    expect(runs[0]!.identity.requestId).toBe(chat.requestId);
    expect((await history.readConversation(c.id)).turns[0]!.attempts[0]!.state).toBe('running');
  } finally {
    await service.close();
    scope.close();
    history.close();
  }
});

it('keeps Chat usable when an API writer fails through the shared channel', async () => {
  const history = new HistoryStore(new DatabaseSync(':memory:'));
  const scope = new ApiCallerScope();
  const selection = {
    deploymentId: 'desktop',
    sessionId: 'session',
    operationId: 'load',
    modelId: record().modelId,
    packageId: 'runtime',
  };
  const active = {
    modelId: selection.modelId,
    revision: 0,
    profileId: capabilities.profileId,
    load: record().load,
  };
  const runs: {
    identity: ExecutionIdentity;
    emit: (chunk: GenerationChunk) => void | Promise<void>;
    finish: (outcome: TerminalOutcome) => void;
    cancelled: boolean;
  }[] = [];
  const owner = new OwnerChatChannel(
    (value) => queueMicrotask(() => remote.receive(value)),
    () => ({
      selection,
      transport: {
        tokenCount: () => Promise.resolve(10),
        start(identity, _messages, emit) {
          let finish!: (outcome: TerminalOutcome) => void;
          const settled = new Promise<TerminalOutcome>((resolve) => {
            finish = resolve;
          });
          const run = { identity, emit, finish, cancelled: false };
          runs.push(run);
          return {
            settled,
            cancel: () => {
              run.cancelled = true;
            },
          };
        },
      },
    }),
    () => remote.close(),
  );
  const remote = new UtilityChatTransport(selection, (value) => {
    queueMicrotask(() => {
      void owner.receive(value).catch(() => remote.close());
    });
  });
  const service = new GenerationService({
    history,
    session: { deploymentId: 'desktop', sessionId: 'session', operationId: 'load' },
    provenance: {
      packageId: 'runtime',
      upstreamCommit: 'a'.repeat(40),
      configuration: {
        modelSha256: selection.modelId,
        contextPerSlot: 7680,
        slots: 4,
        gpuLayers: 0,
        cacheK: 'f16',
        cacheV: 'f16',
        seed: 7,
        temperature: 0.8,
      },
    },
    configuration: {
      capabilities,
      capture: (overrides = {}) =>
        Promise.resolve(resolveRequestSettings(record(), active, overrides, capabilities)),
    },
    cleanup: () => {
      owner.close();
      return Promise.resolve();
    },
    transport: remote,
  });
  try {
    const conversation = await history.newConversation();
    await service.send('window', { conversationId: conversation.id, text: 'Keep Chat running' });
    let writes = 0;
    const api = service.generateApi(
      scope.issue(),
      { messages: [{ role: 'user', content: 'Disconnected API' }], overrides: {} },
      () => {
        writes++;
        return Promise.reject(new Error('CLIENT_DISCONNECTED'));
      },
    );
    await api.admitted;
    await new Promise<void>((resolve) => setImmediate(resolve));
    const chatRun = runs.find((run) => !('kind' in run.identity))!;
    const apiRun = runs.find((run) => 'kind' in run.identity)!;
    let apiSettled = false;
    void api.done.then(() => {
      apiSettled = true;
    });
    const emission = Promise.resolve(apiRun.emit({ type: 'text', text: 'Undeliverable' }));
    void emission.catch(() => undefined);
    await new Promise<void>((resolve) => setImmediate(resolve));

    // The failed writer must not act as a native release receipt or interrupt Chat.
    expect(apiSettled).toBe(false);
    expect((await history.readConversation(conversation.id)).turns[0]!.attempts[0]!.state).toBe(
      'running',
    );
    await emission;
    await apiRun.emit({ type: 'text', text: 'Late in-flight chunk' });
    expect(writes).toBe(1);
    expect(apiRun.cancelled).toBe(true);
    expect(chatRun.cancelled).toBe(false);
    apiRun.finish({ status: 'cancelled', reason: 'USER_CANCELLED' });
    expect(await api.done).toMatchObject({
      outcome: { status: 'cancelled', reason: 'USER_CANCELLED' },
    });

    await chatRun.emit({ type: 'text', text: 'Chat still works' });
    await chatRun.emit({ type: 'terminal', outcome: { status: 'completed', reason: 'STOP' } });
    chatRun.finish({ status: 'completed', reason: 'STOP' });
    await expect
      .poll(async () => (await history.readConversation(conversation.id)).turns[0]!.attempts[0])
      .toMatchObject({
        state: 'completed',
        text: 'Chat still works',
      });
    expect(await history.listConversations()).toHaveLength(1);
  } finally {
    for (const run of runs) run.finish({ status: 'cancelled', reason: 'USER_CANCELLED' });
    await service.close();
    owner.close();
    remote.close();
    scope.close();
    history.close();
  }
});
