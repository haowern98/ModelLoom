import { afterEach, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { ApiController } from '../local-api/controller.js';
import { decodeApiManagementCommand, decodeApiOwnerCommand } from '../local-api/wire.js';
import { decodeModelSource } from './model-source.js';
import { ModelConfigurationStore } from './store.js';
import { capabilities, record } from './test-fixtures.js';

const databases: DatabaseSync[] = [];
afterEach(() => databases.splice(0).forEach((db) => db.close()));
const source = (id: string) => ({
  modelId: id.repeat(64),
  file: `E:\\Models\\${id}.gguf`,
  name: id,
  size: '1 GB',
  sizeBytes: 100,
  modifiedMs: 123,
  architecture: 'llama',
  contextLimit: 4096,
  quantization: 'Q8_0',
  parameters: 'Unknown',
});
const head = () => ({
  ...source('b'),
  architecture: 'dflash',
  contextLimit: 0,
  speculativeHead: 'dspark' as const,
});
function setup() {
  const db = new DatabaseSync(':memory:');
  databases.push(db);
  const store = new ModelConfigurationStore(
    db,
    () => {},
    () => true,
    capabilities,
    record().load,
  );
  return { db, store };
}
it('validates companion classification explicitly and preserves legacy source records', () => {
  expect(decodeModelSource(source('a'))).toEqual(source('a'));
  expect(decodeModelSource(head())).toEqual(head());
  expect(() => decodeModelSource({ ...head(), speculativeHead: 'anything' })).toThrow();
  expect(() => decodeModelSource({ ...head(), speculativeHead: ['dflash'] })).toThrow();
  expect(() => decodeModelSource({ ...head(), architecture: 'llama' })).toThrow();
});
it('keeps companion registration main-only and rejects ordinary models on that command', () => {
  const command = {
    action: 'registerCompanion',
    modelId: head().modelId,
    created: 123,
    source: head(),
  };
  expect(decodeApiOwnerCommand(command)).toEqual(command);
  expect(() => decodeApiManagementCommand(command)).toThrow('INVALID_CONTROL');
  expect(() => decodeApiOwnerCommand({ ...command, source: source('b') })).toThrow();
  expect(() => decodeApiOwnerCommand({ ...command, modelId: 'a'.repeat(64) })).toThrow();
});
it('persists companions without selecting them as the latest target and retains legacy schema', async () => {
  const { db, store } = setup();
  const target = source('a');
  await store.recordImport(target.modelId, 123, target);
  await store.recordImport(head().modelId, 124, head());
  expect(await store.readLatestImportSource()).toEqual(target);
  expect(await store.readLibraryEntry(target.modelId)).toEqual({
    source: head(),
    lastUsedAt: null,
  });
  const reopened = new ModelConfigurationStore(
    db,
    () => {},
    () => true,
    capabilities,
    record().load,
  );
  expect(await reopened.readLatestImportSource()).toEqual(target);
  await reopened.removeImport(target.modelId);
  expect(await reopened.readLatestImportSource()).toBeNull();
  expect(await reopened.readLibraryEntry(null)).toMatchObject({ source: head() });
});
it('registers a non-active companion on the caller-bound owner without making it the API target', async () => {
  const { store } = setup();
  const target = source('a');
  const api = new ApiController(
    store,
    'window',
    target.modelId,
    capabilities,
    () => {
      throw Error('CREDENTIAL_UNAVAILABLE');
    },
    () => false,
    () => undefined,
    0,
  );
  try {
    const command = {
      action: 'registerCompanion',
      modelId: head().modelId,
      created: 123,
      source: head(),
    };
    expect(await api.command('forged', command)).toEqual({ ok: false, error: 'NOT_READY' });
    expect(await api.command('window', command)).toEqual({ ok: true, registered: true });
    expect(await store.readImport(target.modelId)).toBeNull();
    expect(await store.readImport(head().modelId)).toBe(123);
    expect(await api.command('window', { ...command, action: 'registerImport' })).toEqual({
      ok: false,
      error: 'INVALID_CONTROL',
    });
  } finally {
    await api.close();
  }
});
