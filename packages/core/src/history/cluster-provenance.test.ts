import { afterEach, expect, test } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { HistoryStore } from './store.js';
import type { Provenance } from './store.js';
import type { SavedClusterConfiguration } from '../cluster/contracts.js';

const databases: DatabaseSync[] = [];
const stores: HistoryStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const db of databases.splice(0)) if (db.isOpen) db.close();
});
const cluster: SavedClusterConfiguration = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Two GPUs',
  revision: 3,
  modelId: 'b'.repeat(64),
  blockCount: 32,
  profileId: 'cluster-profile',
  load: {
    defaults: {
      automatic: false,
      contextLength: 7680,
      threads: null,
      evaluationBatch: 2048,
      physicalBatch: 512,
      concurrency: 4,
      flashAttention: true,
    },
    cacheK: 'q8_0',
    cacheV: 'q8_0',
  },
  runs: [
    { uuid: 'GPU-11111111-1111-1111-1111-111111111111', first: 0, last: 23 },
    { uuid: 'GPU-22222222-2222-2222-2222-222222222222', first: 24, last: 31 },
  ],
};
const legacy: Provenance = {
  packageId: 'runtime1',
  upstreamCommit: 'a'.repeat(40),
  configuration: {
    modelSha256: cluster.modelId,
    contextPerSlot: 7680,
    slots: 4,
    gpuLayers: 33,
    cacheK: 'q8_0',
    cacheV: 'q8_0',
    seed: 7,
    temperature: 0.8,
  },
};
function setup() {
  const db = new DatabaseSync(':memory:');
  databases.push(db);
  const store = new HistoryStore(db);
  stores.push(store);
  return { db, store };
}
async function begin(store: HistoryStore, provenance: Provenance) {
  const conversation = await store.newConversation();
  await store.beginTurn({
    conversationId: conversation.id,
    turnId: 'turn1',
    attemptId: 'attempt1',
    requestId: 'request1',
    text: 'Question',
    provenance,
  });
  return conversation.id;
}
test('persists complete saved two-GPU intent through JSON history and reopening', async () => {
  const { db, store } = setup();
  const provenance = { ...legacy, cluster };
  const id = await begin(store, provenance);
  await store.finish('attempt1', 'Answer', { status: 'completed', reason: 'STOP' });
  const encoded = db.prepare('SELECT provenance FROM attempts').get()?.provenance;
  expect(JSON.parse(String(encoded))).toEqual(provenance);
  const reopened = new HistoryStore(db);

  expect((await reopened.readConversation(id)).turns[0]?.attempts[0]?.provenance).toEqual(
    provenance,
  );
});
test('preserves legacy provenance without introducing a cluster property', async () => {
  const { db, store } = setup();
  const id = await begin(store, legacy);
  const reopened = new HistoryStore(db);

  const saved = (await reopened.readConversation(id)).turns[0]?.attempts[0]?.provenance;
  expect(saved).toEqual(legacy);
  expect(saved).not.toHaveProperty('cluster');
});
test('retains requested cluster intent alongside the verified padded runtime context', async () => {
  const { store } = setup();
  const padded = {
    ...legacy,
    upstreamCommit: '4f31296a907d73f3409f720429bcf31111615d77',
    configuration: { ...legacy.configuration, contextPerSlot: 7424 },
    cluster: {
      ...cluster,
      load: { ...cluster.load, defaults: { ...cluster.load.defaults, contextLength: 7401 } },
    },
  };
  const id = await begin(store, padded);
  expect((await store.readConversation(id)).turns[0]?.attempts[0]?.provenance).toEqual(padded);
});
test.each([
  ['a'.repeat(40), 7424],
  ['4f31296a907d73f3409f720429bcf31111615d77', 7680],
])(
  'rejects unpinned or excessive padding in history %s/%i',
  async (upstreamCommit, contextPerSlot) => {
    const { store } = setup();
    await expect(
      begin(store, {
        ...legacy,
        upstreamCommit,
        configuration: { ...legacy.configuration, contextPerSlot },
        cluster: {
          ...cluster,
          load: { ...cluster.load, defaults: { ...cluster.load.defaults, contextLength: 7401 } },
        },
      }),
    ).rejects.toThrow('INVALID_HISTORY');
  },
);
test.each([
  { modelSha256: 'c'.repeat(64) },
  { contextPerSlot: 4096 },
  { slots: 2 },
  { cacheK: 'f16' as const },
  { cacheV: 'f16' as const },
])('rejects inconsistent cluster and runtime configuration: %j', async (change) => {
  const { db, store } = setup();
  await expect(
    begin(store, { ...legacy, configuration: { ...legacy.configuration, ...change }, cluster }),
  ).rejects.toThrow('INVALID_HISTORY');
  expect(db.prepare('SELECT COUNT(*) AS count FROM attempts').get()?.count).toBe(0);
});
test('rejects unknown cluster fields instead of storing unverified intent', async () => {
  const { db, store } = setup();
  await expect(
    begin(store, {
      ...legacy,
      cluster: { ...cluster, arguments: ['--unsafe'] } as SavedClusterConfiguration,
    }),
  ).rejects.toThrow();
  expect(db.prepare('SELECT COUNT(*) AS count FROM attempts').get()?.count).toBe(0);
});
