import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, it } from 'vitest';
import { ModelConfigurationStore } from './store.js';
import { capabilities, record } from './test-fixtures.js';
import { decodeModelConfiguration } from './contracts.js';

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

const librarySource = (modelId: string) => ({
  modelId,
  file: `E:\\Models\\${modelId}.gguf`,
  name: 'Indexed model',
  size: '4 GB',
  sizeBytes: 4000000000,
  modifiedMs: 1234,
  architecture: 'llama',
  contextLimit: 4096,
  quantization: 'Q4_K_M',
  parameters: '4B',
});

it('forgets only the selected library entry durably and permits reimport with retained defaults', async () => {
  const { store, database, known } = setup();
  const first = librarySource(record().modelId);
  const second = librarySource('b'.repeat(64));
  known.add(second.modelId);
  await store.recordImport(first.modelId, 123, first);
  await store.recordImport(second.modelId, 124, second);
  const saved = await store.save(first.modelId, 0, await store.read(first.modelId));
  await expect(store.removeImport('../model')).rejects.toThrow('INVALID_CONFIGURATION');
  await store.removeImport(first.modelId);
  const reopened = new ModelConfigurationStore(
    database,
    () => {},
    (id) => known.has(id),
    capabilities,
    record().load,
  );
  expect(await reopened.readImport(first.modelId)).toBeNull();
  expect(await reopened.readImportSource(first.modelId)).toBeNull();
  expect(await reopened.readLibraryEntry(null)).toEqual({ source: second, lastUsedAt: null });
  expect(await reopened.read(first.modelId)).toEqual(saved);
  await reopened.recordImport(first.modelId, 125, first);
  expect(await reopened.readImportSource(first.modelId)).toEqual(first);
});

it('restores every indexed model in identity order with independent usage after reopening', async () => {
  const { store, database, known } = setup();
  const first = librarySource('a'.repeat(64));
  const second = librarySource('b'.repeat(64));
  known.add(second.modelId);
  await store.recordImport(second.modelId, 123, second);
  await store.recordImport(first.modelId, 124, first);
  await store.recordUse(second.modelId, 1000);
  const moved = { ...first, file: 'E:\\Moved\\model.gguf' };
  await store.recordImport(first.modelId, 125, moved);
  const reopened = new ModelConfigurationStore(
    database,
    () => {},
    (id) => known.has(id),
    capabilities,
    record().load,
  );
  expect(await reopened.readLibraryEntry(null)).toEqual({ source: moved, lastUsedAt: null });
  expect(await reopened.readLibraryEntry(first.modelId)).toEqual({
    source: second,
    lastUsedAt: 1000,
  });
  expect(await reopened.readLibraryEntry(second.modelId)).toBeNull();
  expect(database.prepare('SELECT COUNT(*) AS count FROM model_sources').get()?.count).toBe(2);
  expect(await reopened.readImport(first.modelId)).toBe(124);
  await expect(reopened.readLibraryEntry('../secret')).rejects.toThrow();
});

it('rejects corrupted source identity and usage while restoring library entries', async () => {
  const { store, database } = setup();
  const source = librarySource(record().modelId);
  await store.recordImport(source.modelId, 123, source);
  database
    .prepare('UPDATE model_sources SET record=? WHERE model_id=?')
    .run(JSON.stringify({ ...source, modelId: 'b'.repeat(64) }), source.modelId);
  await expect(store.readLibraryEntry(null)).rejects.toThrow('UNSUPPORTED_CONFIGURATION');
  database
    .prepare('UPDATE model_sources SET record=? WHERE model_id=?')
    .run(JSON.stringify(source), source.modelId);
  await store.recordUse(source.modelId, 1000);
  database.prepare('UPDATE model_usage SET last_used=? WHERE model_id=?').run(1.5, source.modelId);
  await expect(store.readLibraryEntry(null)).rejects.toThrow('UNSUPPORTED_CONFIGURATION');
});

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

it('retains the indexed file and metadata across reopen and updates its location without duplicating identity', async () => {
  const { store, database, known } = setup();
  const source = {
    modelId: record().modelId,
    file: 'E:\\Models\\model.gguf',
    name: 'Indexed model',
    size: '4.00 GB',
    sizeBytes: 4000000000,
    modifiedMs: 1234,
    architecture: 'qwen35',
    contextLimit: 4096,
    quantization: 'Q4_K_M',
    parameters: '4B',
  };
  await store.recordImport(source.modelId, 123, source);
  const reopened = new ModelConfigurationStore(
    database,
    () => {},
    (id) => known.has(id),
    capabilities,
    record().load,
  );
  expect(await reopened.readImportSource(source.modelId)).toEqual(source);
  await reopened.recordImport(source.modelId, 456, { ...source, file: 'E:\\Moved\\model.gguf' });
  expect(await reopened.readImport(source.modelId)).toBe(123);
  expect((await reopened.readImportSource(source.modelId))?.file).toBe('E:\\Moved\\model.gguf');
  expect(database.prepare('SELECT COUNT(*) AS count FROM model_sources').get()?.count).toBe(1);
});

it('upgrades only the exact old configuration schema and preserves saved defaults and import times', async () => {
  const database = new DatabaseSync(':memory:');
  databases.push(database);
  database.exec(
    'CREATE TABLE configuration_schema(version INTEGER NOT NULL CHECK(version=1)); INSERT INTO configuration_schema VALUES(1); CREATE TABLE model_configurations(model_id TEXT PRIMARY KEY NOT NULL,revision INTEGER NOT NULL CHECK(revision>0),record TEXT NOT NULL); CREATE TABLE api_credential(id INTEGER PRIMARY KEY CHECK(id=1),generation INTEGER NOT NULL CHECK(generation>0),protected BLOB NOT NULL); CREATE TABLE model_imports(model_id TEXT PRIMARY KEY NOT NULL,created INTEGER NOT NULL CHECK(created>0))',
  );
  database.prepare('INSERT INTO model_imports VALUES(?,?)').run(record().modelId, 123);
  database
    .prepare('INSERT INTO api_credential VALUES(1,?,?)')
    .run(7, Buffer.from('fixture-protected-bytes'));
  const saved = { ...record(), revision: 1 };
  database
    .prepare('INSERT INTO model_configurations VALUES(?,?,?)')
    .run(saved.modelId, 1, JSON.stringify(saved));
  const store = new ModelConfigurationStore(
    database,
    () => {},
    () => true,
    capabilities,
    record().load,
  );
  expect(await store.read(saved.modelId)).toEqual(decodeModelConfiguration(saved, capabilities));
  expect(await store.readImport(saved.modelId)).toBe(123);
  expect(await store.readImportSource(saved.modelId)).toBeNull();
  expect(database.prepare('SELECT version FROM configuration_schema').get()?.version).toBe(4);
  expect(await store.readCredential()).toEqual({
    generation: 7,
    protectedKey: Buffer.from('fixture-protected-bytes'),
  });
});

it('retains last request use across reopen and reimport, without moving backwards', async () => {
  const { store, database, known } = setup();
  const id = record().modelId;
  expect(await store.readUse(id)).toBeNull();
  await store.recordImport(id, 123);
  expect(await store.readUse(id)).toBeNull();
  const timestamp = Date.now() - 1000;
  await store.recordUse(id, timestamp);
  await store.recordUse(id, timestamp - 1000);
  await store.recordImport(id, 456);
  const reopened = new ModelConfigurationStore(
    database,
    () => {},
    (id) => known.has(id),
    capabilities,
    record().load,
  );
  expect(await reopened.readUse(id)).toBe(timestamp);
  expect(await reopened.readImport(id)).toBe(123);
  await expect(store.recordUse('b'.repeat(64), timestamp)).rejects.toThrow('UNKNOWN_MODEL');
  for (const invalid of [0, -1, NaN, 1.5, Date.now() + 60000])
    await expect(store.recordUse(id, invalid)).rejects.toThrow('INVALID_CONFIGURATION');
});

it('upgrades the exact indexed schema without losing the imported source', async () => {
  const { database, store, known } = setup();
  const id = record().modelId;
  const source = {
    modelId: id,
    file: 'E:\\Models\\model.gguf',
    name: 'Indexed model',
    size: '4 GB',
    sizeBytes: 4000000000,
    modifiedMs: 1234,
    architecture: 'llama',
    contextLimit: 4096,
    quantization: 'Q4_K_M',
    parameters: '4B',
  };
  await store.recordImport(id, 123, source);
  await store.save(id, 0, await store.read(id));
  await store.replaceCredential(0, Buffer.from('fixture-protected-bytes'));
  // Recreate the previous schema version while preserving its retained tables.
  database.exec(
    'DROP TABLE cluster_drafts; DROP TABLE cluster_configurations; DROP TABLE model_usage; DROP TABLE configuration_schema; CREATE TABLE configuration_schema(version INTEGER NOT NULL CHECK(version=2)); INSERT INTO configuration_schema VALUES(2)',
  );
  const reopened = new ModelConfigurationStore(
    database,
    () => {},
    (id) => known.has(id),
    capabilities,
    record().load,
  );
  expect(await reopened.readImport(id)).toBe(123);
  expect(await reopened.readImportSource(id)).toEqual(source);
  expect((await reopened.read(id)).revision).toBe(1);
  expect((await reopened.readCredential())?.protectedKey).toEqual(
    Buffer.from('fixture-protected-bytes'),
  );
  expect(await reopened.readUse(id)).toBeNull();
  expect(database.prepare('SELECT version FROM configuration_schema').get()?.version).toBe(4);
});

it('retains the previous use on write failure and rejects malformed stored timestamps', async () => {
  const { store, database } = setup();
  const id = record().modelId;
  const timestamp = Date.now() - 1000;
  await store.recordUse(id, timestamp);
  database.exec(
    "CREATE TRIGGER reject_usage BEFORE UPDATE ON model_usage BEGIN SELECT RAISE(ABORT,'failure'); END",
  );
  await expect(store.recordUse(id, timestamp + 1000)).rejects.toThrow('CONFIGURATION_UNAVAILABLE');
  expect(await store.readUse(id)).toBe(timestamp);
  database.exec('DROP TRIGGER reject_usage');
  database.prepare('UPDATE model_usage SET last_used=? WHERE model_id=?').run(1.5, id);
  await expect(store.readUse(id)).rejects.toThrow('UNSUPPORTED_CONFIGURATION');
});

it('rolls back import time and file metadata together when saving the index fails', async () => {
  const { store, database } = setup();
  database.exec(
    "CREATE TRIGGER reject_source BEFORE INSERT ON model_sources BEGIN SELECT RAISE(ABORT,'failure'); END",
  );
  const source = {
    modelId: record().modelId,
    file: 'E:\\Models\\model.gguf',
    name: 'Model',
    size: '1 GB',
    sizeBytes: 100,
    modifiedMs: 1234,
    architecture: 'qwen35',
    contextLimit: 4096,
    quantization: 'Unknown',
    parameters: 'Unknown',
  };
  await expect(store.recordImport(source.modelId, 123, source)).rejects.toThrow(
    'CONFIGURATION_UNAVAILABLE',
  );
  expect(await store.readImport(source.modelId)).toBeNull();
  expect(await store.readImportSource(source.modelId)).toBeNull();
});

it('rejects malformed stored model locations without passing them to restoration', async () => {
  const { store, database } = setup();
  await store.recordImport(record().modelId, 123);
  database
    .prepare('INSERT INTO model_sources VALUES(?,?)')
    .run(record().modelId, JSON.stringify({ modelId: record().modelId, file: '../secret' }));
  await expect(store.readImportSource(record().modelId)).rejects.toThrow();
  expect(await store.readImport(record().modelId)).toBe(123);
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
