import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, it } from 'vitest';
import { HistoryStore } from '../history/store.js';
import type { Provenance } from '../history/store.js';
import { capabilities, record } from '../model-configuration/test-fixtures.js';
import type {
  AdvancedPreferences,
  ModelConfigurationRecord,
  ResolvedRequestSettings,
} from '../model-configuration/contracts.js';
import { resolveRequestSettings } from '../model-configuration/resolve.js';
import { ApiCallerScope } from './api-authority.js';
import { GenerationService } from './service.js';
import type { ChatMessage } from './service.js';
import type { GenerationChunk, TerminalOutcome } from './contracts.js';

const disposals: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const dispose of disposals.splice(0)) await dispose();
});
async function drain() {
  for (let i = 0; i < 60; i++) await Promise.resolve();
}
function setup(overflow: AdvancedPreferences['overflow']) {
  const history = new HistoryStore(new DatabaseSync(':memory:'));
  let saved: ModelConfigurationRecord = {
    ...record(),
    load: { ...record().load, contextLength: 100, concurrency: 1 },
    generation: { ...record().generation, systemPrompt: 'Instruction' },
  };
  let loadedOverflow = overflow;
  const provenance: Provenance = {
    packageId: 'runtime',
    upstreamCommit: 'a'.repeat(40),
    configuration: {
      modelSha256: saved.modelId,
      contextPerSlot: 100,
      slots: 1,
      gpuLayers: 0,
      cacheK: 'f16',
      cacheV: 'f16',
      seed: 7,
      temperature: 0.8,
    },
  };
  const runs: {
    messages: readonly ChatMessage[];
    settings: ResolvedRequestSettings | undefined;
    emit: (chunk: GenerationChunk) => void | Promise<void>;
    finish: (outcome: TerminalOutcome) => void;
  }[] = [];
  const scope = new ApiCallerScope();
  const caller = scope.issue();
  const service = new GenerationService({
    session: { deploymentId: 'desktop', sessionId: 'session', operationId: 'load' },
    history,
    provenance,
    cleanup: () => Promise.resolve(),
    configuration: {
      capabilities,
      capture: (overrides = {}) =>
        Promise.resolve(
          resolveRequestSettings(
            saved,
            {
              modelId: saved.modelId,
              revision: 1,
              profileId: capabilities.profileId,
              load: saved.load,
              preferences: { ...saved.preferences, overflow: loadedOverflow },
            },
            overrides,
            capabilities,
          ),
        ),
    },
    transport: {
      tokenCount: (messages) => Promise.resolve(messages.length * 20),
      start: (_identity, messages, emit, settings) => {
        let finish!: (outcome: TerminalOutcome) => void;
        const settled = new Promise<TerminalOutcome>((resolve) => {
          finish = resolve;
        });
        runs.push({ messages, settings, emit, finish });
        return { settled, cancel: () => finish({ status: 'cancelled', reason: 'USER_CANCELLED' }) };
      },
    },
  });
  disposals.push(async () => {
    await service.close();
    scope.close();
    history.close();
  });
  return {
    history,
    service,
    provenance,
    runs,
    caller,
    changeLoadedPolicy: (policy: AdvancedPreferences['overflow']) => {
      loadedOverflow = policy;
    },
    changeSavedDefaults: () => {
      saved = {
        ...saved,
        revision: saved.revision + 1,
        generation: { ...saved.generation, temperature: 0.1, systemPrompt: 'New instruction' },
        preferences: { ...saved.preferences, overflow: 'stop' },
      };
    },
  };
}
const messages: readonly ChatMessage[] = [
  { role: 'system', content: 'Instruction' },
  ...[1, 2, 3, 4].flatMap((n): ChatMessage[] => [
    { role: 'user', content: `Question ${n}` },
    { role: 'assistant', content: `Answer ${n}` },
  ]),
  { role: 'user', content: 'Latest' },
];
const expected = (policy: AdvancedPreferences['overflow']) => [
  messages[0],
  ...(policy === 'rolling' ? messages.slice(7, 9) : messages.slice(1, 3)),
  messages[9],
];

it.each(['rolling', 'truncate-middle'] as const)(
  'fits Chat dispatch using %s without deleting retained history',
  async (policy) => {
    const { history, service, provenance, runs } = setup(policy);
    const conversation = await history.newConversation();
    for (let n = 1; n <= 4; n++) {
      const attemptId = randomUUID();
      await history.beginTurn({
        conversationId: conversation.id,
        turnId: randomUUID(),
        attemptId,
        requestId: randomUUID(),
        text: `Question ${n}`,
        provenance,
      });
      await history.finish(attemptId, `Answer ${n}`, { status: 'completed', reason: 'STOP' });
    }
    await service.send('window', { conversationId: conversation.id, text: 'Latest' });
    await drain();
    expect(runs[0]?.messages).toEqual(expected(policy));
    const retained = await history.readConversation(conversation.id);
    expect(retained.turns.map((turn) => turn.text)).toEqual([
      'Question 1',
      'Question 2',
      'Question 3',
      'Question 4',
      'Latest',
    ]);
    expect(retained.turns.slice(0, 4).map((turn) => turn.attempts[0]?.text)).toEqual([
      'Answer 1',
      'Answer 2',
      'Answer 3',
      'Answer 4',
    ]);
  },
);

it.each(['rolling', 'truncate-middle'] as const)(
  'fits stateless API dispatch using %s and permits cumulative usage beyond context',
  async (policy) => {
    const { service, caller, runs, history } = setup(policy);
    const handle = service.generateApi(caller, { messages, overrides: {} }, () => {});
    await handle.admitted;
    await drain();
    expect(runs[0]?.messages).toEqual(expected(policy));
    await runs[0]!.emit({ type: 'text', text: 'Response' });
    await runs[0]!.emit({
      type: 'terminal',
      outcome: { status: 'completed', reason: 'STOP' },
      usage: { prompt_tokens: 80, completion_tokens: 150, total_tokens: 230 },
    });
    runs[0]!.finish({ status: 'completed', reason: 'STOP' });
    expect(await handle.done).toMatchObject({
      outcome: { status: 'completed', reason: 'STOP' },
      text: 'Response',
      usage: { total_tokens: 230 },
    });
    expect(await history.listConversations()).toEqual([]);
  },
);

it('still refuses an API completion beyond the explicit output limit with shifting enabled', async () => {
  const { service, caller, runs } = setup('rolling');
  const handle = service.generateApi(caller, { messages, overrides: { max_tokens: 10 } }, () => {});
  await handle.admitted;
  await drain();
  await expect(
    Promise.resolve(
      runs[0]!.emit({
        type: 'terminal',
        outcome: { status: 'completed', reason: 'STOP' },
        usage: { prompt_tokens: 80, completion_tokens: 11, total_tokens: 91 },
      }),
    ),
  ).rejects.toThrow('INVALID_STREAM');
  expect(await handle.done).toMatchObject({
    outcome: { status: 'failed', reason: 'INVALID_STREAM' },
  });
});

it('retains queued captured defaults and refuses Retry after the loaded overflow policy changes', async () => {
  const { service, history, runs, changeSavedDefaults, changeLoadedPolicy } = setup('rolling');
  const first = await history.newConversation();
  const queued = await history.newConversation();
  await service.send('window', { conversationId: first.id, text: 'First' });
  const identity = await service.send('window', { conversationId: queued.id, text: 'Queued' });
  await drain();
  expect(runs).toHaveLength(1);
  changeSavedDefaults();
  await service.cancelConversation('window', first.id);
  await drain();
  expect(runs[1]?.settings).toMatchObject({
    overflow: 'rolling',
    systemPrompt: 'Instruction',
    parameters: { temperature: 0.8 },
  });
  expect(runs[1]?.messages[0]).toEqual({ role: 'system', content: 'Instruction' });
  await service.cancelConversation('window', queued.id);
  await drain();
  changeLoadedPolicy('truncate-middle');
  await expect(service.retry('window', identity.attemptId)).rejects.toThrow('SETTINGS_UNAVAILABLE');
  expect((await history.readConversation(queued.id)).turns[0]?.attempts).toHaveLength(1);
  expect(runs).toHaveLength(2);
});
