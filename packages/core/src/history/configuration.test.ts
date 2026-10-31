import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import type { Provenance } from './store.js';
import { HistoryStore } from './store.js';
import { resolveRequestSettings } from '../model-configuration/resolve.js';
import { capabilities, record } from '../model-configuration/test-fixtures.js';
import { decodeResolvedRequestSettings } from '../model-configuration/contracts.js';

const settings = resolveRequestSettings(
  record(),
  {
    modelId: record().modelId,
    revision: 1,
    profileId: capabilities.profileId,
    load: record().load,
  },
  {},
  capabilities,
);
const provenance: Provenance = {
  packageId: 'runtime',
  upstreamCommit: 'a'.repeat(40),
  configuration: {
    modelSha256: settings.modelId,
    contextPerSlot: 7680,
    slots: 4,
    gpuLayers: 0,
    cacheK: 'f16',
    cacheV: 'f16',
    seed: 7,
    temperature: 0.8,
  },
};

it('round-trips an immutable request snapshot and retries its original settings', async () => {
  const database = new DatabaseSync(':memory:');
  const store = new HistoryStore(database);
  try {
    const conversation = await store.newConversation();
    await store.beginTurn({
      conversationId: conversation.id,
      turnId: 'turn',
      attemptId: 'first',
      requestId: 'request',
      text: 'Synthetic prompt',
      provenance,
      settings,
    });
    await store.finish('first', '', { status: 'cancelled', reason: 'USER_CANCELLED' });
    expect((await store.retrySource('first')).settings).toEqual(settings);
    await store.retry('first', 'second', 'retry', provenance, settings);
    expect(
      (await store.readConversation(conversation.id)).turns[0]!.attempts.map((a) => a.settings),
    ).toEqual([settings, settings]);
    expect(database.prepare('SELECT version FROM schema_version').get()?.version).toBe(6);
  } finally {
    store.close();
  }
});

it('retains unknown legacy settings and rejects privileged or malformed snapshot fields', async () => {
  const database = new DatabaseSync(':memory:');
  const store = new HistoryStore(database);
  try {
    const conversation = await store.newConversation();
    await store.beginTurn({
      conversationId: conversation.id,
      turnId: 'turn',
      attemptId: 'legacy',
      requestId: 'request',
      text: 'Synthetic prompt',
      provenance,
    });
    expect((await store.retrySource('legacy')).settings).toBeNull();
    for (const input of [
      { ...settings, url: 'private' },
      { ...settings, parameters: { ...settings.parameters, id_slot: 0 } },
      { ...settings, parameters: { ...settings.parameters, max_tokens: 513 } },
    ])
      expect(() => decodeResolvedRequestSettings(input, capabilities)).toThrow(
        'INVALID_CONFIGURATION',
      );
    expect(Object.isFrozen(decodeResolvedRequestSettings(settings, capabilities).parameters)).toBe(
      true,
    );
  } finally {
    store.close();
  }
});
