import { DatabaseSync } from 'node:sqlite';
import { expect, it, vi } from 'vitest';
import { GenerationService } from './service.js';
import { ApiCallerScope } from './api-authority.js';
import { HistoryStore } from '../history/store.js';
import { capabilities, record } from '../model-configuration/test-fixtures.js';
import { resolveRequestSettings } from '../model-configuration/resolve.js';
import type { GenerationChunk, ExecutionIdentity, TerminalOutcome } from './contracts.js';
it('retains uncertain API capacity until the deadline, closes shared admission and preserves interrupted Chat', async () => {
  vi.useFakeTimers();
  const history = new HistoryStore(new DatabaseSync(':memory:')),
    scope = new ApiCallerScope();
  const active = {
    modelId: record().modelId,
    revision: 0,
    profileId: capabilities.profileId,
    load: record().load,
  };
  let cleanups = 0;
  const started: {
    identity: ExecutionIdentity;
    emit: (chunk: GenerationChunk) => void | Promise<void>;
  }[] = [];
  const service = new GenerationService({
    history,
    session: { deploymentId: 'desktop', sessionId: 'session', operationId: 'load' },
    provenance: {
      packageId: 'fixture',
      upstreamCommit: 'a'.repeat(40),
      configuration: {
        modelSha256: active.modelId,
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
      capture: (overrides) =>
        Promise.resolve(resolveRequestSettings(record(), active, overrides ?? {}, capabilities)),
    },
    cleanup: () => {
      cleanups++;
      return Promise.resolve();
    },
    transport: {
      tokenCount: () => Promise.resolve(10),
      start: (identity, _messages, emit) => {
        let finish!: (outcome: TerminalOutcome) => void;
        const settled = new Promise<TerminalOutcome>((resolve) => {
          finish = resolve;
        });
        started.push({ identity, emit });
        return {
          settled,
          cancel: () => {
            if (!('kind' in identity)) finish({ status: 'cancelled', reason: 'USER_CANCELLED' });
          },
        };
      },
    },
  });
  try {
    const chats = await Promise.all(Array.from({ length: 3 }, () => history.newConversation()));
    for (const chat of chats)
      await service.send('window', { conversationId: chat.id, text: 'Synthetic prompt' });
    await started[0]!.emit({ type: 'text', text: 'Saved partial' });
    const request = { messages: [{ role: 'user' as const, content: 'API prompt' }], overrides: {} };
    const activeApi = service.generateApi(scope.issue(), request, () => {});
    const queued = service.generateApi(scope.issue(), request, () => {});
    await activeApi.admitted;
    await queued.admitted;
    expect(started).toHaveLength(4);
    let done = false;
    void activeApi.done.then(() => {
      done = true;
    });
    activeApi.cancel();
    await vi.advanceTimersByTimeAsync(4999);
    expect(done).toBe(false);
    expect(started).toHaveLength(4);
    await vi.advanceTimersByTimeAsync(1);
    expect(await activeApi.done).toMatchObject({
      outcome: { status: 'failed', reason: 'CANCEL_UNCONFIRMED' },
      recoveryRequired: true,
    });
    expect((await queued.done).outcome.status).toBe('interrupted');
    expect(started).toHaveLength(4);
    expect(cleanups).toBe(1);
    await expect(service.generateApi(scope.issue(), request, () => {}).done).rejects.toThrow(
      'NOT_READY',
    );
    await service.close();
    expect((await history.readConversation(chats[0]!.id)).turns[0]!.attempts[0]).toMatchObject({
      text: 'Saved partial',
      state: 'interrupted',
    });
  } finally {
    await service.close();
    scope.close();
    history.close();
    vi.useRealTimers();
  }
});
