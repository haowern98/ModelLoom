import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, it } from 'vitest';
import { ApiController } from '../local-api/controller.js';
import { decodeApiManagementCommand, decodeApiOwnerCommand } from '../local-api/wire.js';
import { decodeModelSource } from './model-source.js';
import type { ModelSource } from './model-source.js';
import { ModelConfigurationStore } from './store.js';
import { capabilities, record } from './test-fixtures.js';

const databases: DatabaseSync[] = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));

const source = (key: string): ModelSource => ({
  modelId: key.repeat(64),
  file: `E:\\Models\\${key}.gguf`,
  name: `Model ${key}`,
  size: '2 GB',
  sizeBytes: 2_000_000_000,
  modifiedMs: 1234,
  architecture: 'qwen35',
  contextLimit: 4096,
  blockCount: 4,
  quantization: 'Q8_0',
  parameters: 'Unknown',
});
function setup() {
  const database = new DatabaseSync(':memory:');
  databases.push(database);
  const store = new ModelConfigurationStore(
    database,
    () => {},
    () => true,
    capabilities,
    record().load,
  );
  return { database, store };
}

it('repairs metadata in place without changing import timestamps or source ordering', async () => {
  const { database, store } = setup();
  const first = source('a');
  const second = source('b');
  await store.recordImport(first.modelId, 100, first);
  await store.recordImport(second.modelId, 200, second);
  const original = database
    .prepare('SELECT rowid,model_id FROM model_sources ORDER BY rowid')
    .all();
  const repaired: ModelSource = { ...first, classificationVersion: 1, speculativeHead: 'mtp' };
  await store.reinspectImport(repaired);
  expect(await store.readImportSource(first.modelId)).toEqual(repaired);
  expect(await store.readImport(first.modelId)).toBe(100);
  expect(await store.readImport(second.modelId)).toBe(200);
  expect(database.prepare('SELECT rowid,model_id FROM model_sources ORDER BY rowid').all()).toEqual(
    original,
  );
  expect(await store.readLatestImportSource()).toEqual(second);
});

it('rejects unregistered identities, changed source identity and missing classification version', async () => {
  const { store } = setup();
  const original = source('a');
  await store.recordImport(original.modelId, 100, original);
  const repaired: ModelSource = { ...original, classificationVersion: 1, speculativeHead: 'mtp' };
  for (const invalid of [
    { ...repaired, modelId: 'b'.repeat(64) },
    { ...repaired, file: 'E:\\Moved\\a.gguf' },
    { ...repaired, sizeBytes: original.sizeBytes + 1 },
    { ...repaired, modifiedMs: original.modifiedMs + 1 },
    original,
  ]) {
    await expect(store.reinspectImport(invalid)).rejects.toThrow('INVALID_CONFIGURATION');
    expect(await store.readImportSource(original.modelId)).toEqual(original);
  }
});

it('admits bounded versioned repair only through the private owner protocol', () => {
  const repaired: ModelSource = {
    ...source('a'),
    speculativeHead: 'mtp',
    classificationVersion: 1,
  };
  const command = { action: 'reinspectImport', modelId: repaired.modelId, source: repaired };
  expect(decodeApiOwnerCommand(command)).toEqual(command);
  expect(() => decodeApiManagementCommand(command)).toThrow('INVALID_CONTROL');
  for (const invalid of [
    { ...command, modelId: 'b'.repeat(64) },
    { ...command, source: source('a') },
    { ...command, source: { ...repaired, classificationVersion: 2 } },
    { ...command, source: { ...repaired, classificationVersion: '1' } },
    { ...command, source: { ...repaired, speculativeHead: 'unknown' } },
    { ...command, created: 100 },
  ])
    expect(() => decodeApiOwnerCommand(invalid)).toThrow();
  expect(() =>
    decodeModelSource({ ...repaired, architecture: 'dflash', speculativeHead: 'mtp' }),
  ).toThrow('INVALID_CONFIGURATION');
});

it('keeps repair caller-bound and stopped while allowing correction of the current owner to a head', async () => {
  const { store } = setup();
  const original = source('a');
  await store.recordImport(original.modelId, 100, original);
  const repaired: ModelSource = { ...original, speculativeHead: 'mtp', classificationVersion: 1 };
  let ready = false;
  const api = new ApiController(
    store,
    'window',
    original.modelId,
    capabilities,
    () => {
      throw Error('CREDENTIAL_UNAVAILABLE');
    },
    () => ready,
    () => undefined,
  );
  const command = { action: 'reinspectImport', modelId: original.modelId, source: repaired };
  try {
    expect(await api.command('forged', command)).toEqual({ ok: false, error: 'NOT_READY' });
    ready = true;
    expect(await api.command('window', command)).toEqual({ ok: false, error: 'NOT_READY' });
    expect(await store.readImportSource(original.modelId)).toEqual(original);
    ready = false;
    expect(await api.command('window', command)).toEqual({ ok: true, registered: true });
    expect(await store.readImportSource(original.modelId)).toEqual(repaired);
    expect(await store.readImport(original.modelId)).toBe(100);
    const ordinary: ModelSource = { ...original, classificationVersion: 1 };
    expect(await api.command('window', { ...command, source: ordinary })).toEqual({
      ok: true,
      registered: true,
    });
    expect(await store.readImportSource(original.modelId)).toEqual(ordinary);
  } finally {
    await api.close();
  }
});
