import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { ModelConfigurationStore } from './store.js';
import { capabilities, record } from './test-fixtures.js';
it('atomically stores protected credentials and retains the old generation after failure', async () => {
  const database = new DatabaseSync(':memory:');
  let failed = false;
  const store = new ModelConfigurationStore(
    database,
    () => {
      if (failed) throw new Error('private');
    },
    () => true,
    capabilities,
    record().load,
  );
  try {
    expect(await store.readCredential()).toBeNull();
    const protectedKey = Buffer.from('Synthetic protected bytes');
    expect(await store.replaceCredential(0, protectedKey)).toEqual({ generation: 1, protectedKey });
    await expect(store.replaceCredential(0, Buffer.from('stale'))).rejects.toThrow(
      'STALE_CONFIGURATION',
    );
    failed = true;
    await expect(store.replaceCredential(1, Buffer.from('replacement'))).rejects.toThrow(
      'CONFIGURATION_UNAVAILABLE',
    );
    expect(await store.readCredential()).toEqual({ generation: 1, protectedKey });
    expect(database.prepare('SELECT protected FROM api_credential').get()?.protected).toEqual(
      new Uint8Array(protectedKey),
    );
  } finally {
    database.close();
  }
});
it('retains the first recorded import timestamp for an identical verified model', async () => {
  const database = new DatabaseSync(':memory:');
  const store = new ModelConfigurationStore(
    database,
    () => {},
    (id) => id === record().modelId,
    capabilities,
    record().load,
  );
  try {
    expect(await store.readImport(record().modelId)).toBeNull();
    expect(await store.recordImport(record().modelId, 123)).toBe(123);
    expect(await store.recordImport(record().modelId, 456)).toBe(123);
    const reopened = new ModelConfigurationStore(
      database,
      () => {},
      (id) => id === record().modelId,
      capabilities,
      record().load,
    );
    expect(await reopened.readImport(record().modelId)).toBe(123);
    await expect(store.recordImport('b'.repeat(64), 123)).rejects.toThrow('UNKNOWN_MODEL');
  } finally {
    database.close();
  }
});
