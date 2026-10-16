import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { GenerationService } from './service.js';
import type { ChatMessage } from './service.js';
import type { GenerationChunk, TerminalOutcome } from './contracts.js';
import { HistoryStore } from '../history/store.js';
import { capabilities, record } from '../model-configuration/test-fixtures.js';
import type { ResolvedRequestSettings } from '../model-configuration/contracts.js';
import { resolveRequestSettings } from '../model-configuration/resolve.js';

it('captures settings before token accounting and retains them through queueing and Retry', async () => {
  const history = new HistoryStore(new DatabaseSync(':memory:'));
  let saved = {
    ...record(),
    generation: { ...record().generation, systemPrompt: 'Original instruction' },
  };
  const active = {
    modelId: saved.modelId,
    revision: 1,
    profileId: capabilities.profileId,
    load: saved.load,
  };
  const counts: {
    messages: readonly ChatMessage[];
    settings: ResolvedRequestSettings | undefined;
  }[] = [];
  const runs: {
    settings: ResolvedRequestSettings | undefined;
    emit: (chunk: GenerationChunk) => void | Promise<void>;
    resolve: (outcome: TerminalOutcome) => void;
  }[] = [];
  const service = new GenerationService({
    session: { deploymentId: 'desktop', sessionId: 'session', operationId: 'load' },
    history,
    provenance: {
      packageId: 'runtime',
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
      capture: () => Promise.resolve(resolveRequestSettings(saved, active, {}, capabilities)),
    },
    cleanup: () => Promise.resolve(),
    transport: {
      tokenCount: (messages, _signal, settings) => {
        counts.push({ messages, settings });
        return Promise.resolve(10);
      },
      start: (_identity, _messages, emit, settings) => {
        let resolve!: (outcome: TerminalOutcome) => void;
        const settled = new Promise<TerminalOutcome>((yes) => {
          resolve = yes;
        });
        runs.push({ settings, emit, resolve });
        return {
          settled,
          cancel: () => resolve({ status: 'cancelled', reason: 'USER_CANCELLED' }),
        };
      },
    },
  });
  try {
    const conversations = await Promise.all(
      Array.from({ length: 5 }, () => history.newConversation()),
    );
    const identities = [];
    for (const c of conversations)
      identities.push(await service.send('window', { conversationId: c.id, text: 'Question' }));
    expect(counts).toHaveLength(5);
    expect(counts[4]!.messages[0]).toEqual({ role: 'system', content: 'Original instruction' });
    const captured = counts[4]!.settings;
    expect(captured).toBeDefined();
    expect(captured?.parameters.max_tokens).toBe(-1);
    saved = {
      ...saved,
      revision: 8,
      generation: { ...saved.generation, temperature: 0.1, systemPrompt: 'Changed' },
    };
    await service.cancelConversation('window', conversations[0]!.id);
    for (let i = 0; i < 30; i++) await Promise.resolve();
    expect(runs[4]!.settings).toEqual(captured);
    await service.cancelConversation('window', conversations[4]!.id);
    for (let i = 0; i < 30; i++) await Promise.resolve();
    await service.retry('window', identities[4]!.attemptId);
    expect(counts[5]!.settings).toEqual(captured);
    expect(counts[5]!.messages[0]).toEqual({ role: 'system', content: 'Original instruction' });
    expect((await history.retrySource(identities[4]!.attemptId)).settings).toEqual(captured);
  } finally {
    await service.close();
    history.close();
  }
});

it.each([
  { tokens: 7679, capped: false, admitted: true },
  { tokens: 7679, capped: true, admitted: false },
  { tokens: 7680, capped: false, admitted: false },
])(
  'reserves actual response capacity for Chat: $tokens prompt tokens, capped=$capped',
  async ({ tokens, capped, admitted }) => {
    const history = new HistoryStore(new DatabaseSync(':memory:'));
    const saved = record();
    saved.generation.responseLength = { enabled: capped, value: 128 };
    const active = {
      modelId: saved.modelId,
      revision: 1,
      profileId: capabilities.profileId,
      load: saved.load,
    };
    let starts = 0;
    const service = new GenerationService({
      history,
      session: { deploymentId: 'desktop', sessionId: 'session', operationId: 'load' },
      provenance: {
        packageId: 'runtime',
        upstreamCommit: 'a'.repeat(40),
        configuration: {
          modelSha256: saved.modelId,
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
        capture: () => Promise.resolve(resolveRequestSettings(saved, active, {}, capabilities)),
      },
      cleanup: () => Promise.resolve(),
      transport: {
        tokenCount: () => Promise.resolve(tokens),
        start: (_identity, _messages, _emit, settings) => {
          starts++;
          expect(settings?.parameters.max_tokens).toBe(capped ? 128 : -1);
          return {
            settled: Promise.resolve({ status: 'completed' as const, reason: 'STOP' as const }),
            cancel: () => {},
          };
        },
      },
    });
    try {
      const conversation = await history.newConversation();
      const sent = service.send('window', { conversationId: conversation.id, text: 'Question' });
      if (admitted) {
        const identity = await sent;
        expect(
          (await history.retrySource(identity.attemptId)).settings?.parameters.max_tokens,
        ).toBe(-1);
        expect(starts).toBe(1);
      } else {
        await expect(sent).rejects.toThrow('CONTEXT_FULL');
        expect(starts).toBe(0);
      }
    } finally {
      await service.close();
      history.close();
    }
  },
);
