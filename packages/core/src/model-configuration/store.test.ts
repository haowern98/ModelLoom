import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, it } from 'vitest';
import { ModelConfigurationStore } from './store.js';
import { capabilities, record } from './test-fixtures.js';

const databases: DatabaseSync[] = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));
function setup(reserve = () => {}) {
  const database = new DatabaseSync(':memory:');
  databases.push(database);
  const known = new Set([record().modelId]);
  const store = new ModelConfigurationStore(
    database,
    reserve,
    (modelId) => known.has(modelId),
    capabilities,
    record().load,
  );
  return { database, store, known };
}

it('atomically saves revisions and reopens committed model defaults', async () => {
  const { database, store, known } = setup();
  const initial = await store.read(record().modelId);
  expect(initial.revision).toBe(0);
  const saved = await store.save(initial.modelId, 0, {
    ...initial,
    generation: { ...initial.generation, temperature: 0.2 },
  });
  expect(saved.revision).toBe(1);
  const reopened = new ModelConfigurationStore(
    database,
    () => {},
    (id) => known.has(id),
    capabilities,
    record().load,
  );
  expect((await reopened.read(initial.modelId)).generation.temperature).toBe(0.2);
});

it('rejects stale concurrent saves and unknown or mismatched model identities', async () => {
  const { store } = setup();
  const initial = await store.read(record().modelId);
  const results = await Promise.allSettled([
    store.save(initial.modelId, 0, initial),
    store.save(initial.modelId, 0, initial),
  ]);
  expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
  await expect(store.read('b'.repeat(64))).rejects.toThrow('UNKNOWN_MODEL');
  await expect(
    store.save(initial.modelId, 1, { ...initial, modelId: 'b'.repeat(64) }),
  ).rejects.toThrow('INVALID_CONFIGURATION');
});

it('retains committed values when reservation or a database write fails', async () => {
  let fail = false;
  const { store, database } = setup(() => {
    if (fail) throw Error('private path');
  });
  const initial = await store.read(record().modelId);
  await store.save(initial.modelId, 0, initial);
  fail = true;
  await expect(store.save(initial.modelId, 1, { ...initial, revision: 1 })).rejects.toThrow(
    /^CONFIGURATION_UNAVAILABLE$/,
  );
  expect((await store.read(initial.modelId)).revision).toBe(1);
  fail = false;
  database.exec('PRAGMA query_only=ON');
  await expect(store.save(initial.modelId, 1, { ...initial, revision: 1 })).rejects.toThrow(
    /^CONFIGURATION_UNAVAILABLE$/,
  );
  expect((await store.read(initial.modelId)).revision).toBe(1);
});

it('fails closed for an unknown schema without repairing or deleting it', () => {
  const database = new DatabaseSync(':memory:');
  databases.push(database);
  database.exec("CREATE TABLE unrelated(value TEXT); INSERT INTO unrelated VALUES ('preserved')");
  expect(
    () =>
      new ModelConfigurationStore(
        database,
        () => {},
        () => true,
        capabilities,
        record().load,
      ),
  ).toThrow('UNSUPPORTED_CONFIGURATION');
  expect(database.prepare('SELECT value FROM unrelated').get()?.value).toBe('preserved');
});

it('rejects unsupported executable defaults before committing a new revision', async () => {
  const { store } = setup();
  const initial = await store.read(record().modelId);
  await expect(
    store.save(initial.modelId, 0, {
      ...initial,
      generation: { ...initial.generation, responseLength: { enabled: true, value: 1024 } },
    }),
  ).rejects.toThrow('INVALID_CONFIGURATION');
  await expect(
    store.save(initial.modelId, 0, {
      ...initial,
      generation: { ...initial.generation, thinking: false },
    }),
  ).rejects.toThrow('UNSUPPORTED_SETTING');
  expect((await store.read(initial.modelId)).revision).toBe(0);
});
