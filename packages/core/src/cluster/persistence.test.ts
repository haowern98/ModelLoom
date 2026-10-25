import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, it } from 'vitest';
import { ModelConfigurationStore } from '../model-configuration/store.js';
import { capabilities, record } from '../model-configuration/test-fixtures.js';
const dbs: DatabaseSync[] = [];
afterEach(() => dbs.splice(0).forEach((db) => db.close()));
function setup() {
  const db = new DatabaseSync(':memory:');
  dbs.push(db);
  const store = new ModelConfigurationStore(
    db,
    () => {},
    (id) => id === record().modelId,
    capabilities,
    record().load,
  );
  return { db, store };
}
const uuid = 'GPU-12345678-1234-1234-1234-123456789abc';
const edit = {
  modelId: record().modelId,
  load: { defaults: record().load, cacheK: 'q8_0' as const, cacheV: 'q8_0' as const },
  runs: [{ uuid, first: '0', last: '-' }],
};
const source = {
  modelId: edit.modelId,
  file: 'E:\\Models\\model.gguf',
  name: 'Model',
  size: '4 GB',
  sizeBytes: 4000,
  modifiedMs: 1,
  architecture: 'llama',
  contextLimit: 32768,
  blockCount: 64,
  quantization: 'Q4_K_M',
  parameters: '4B',
};
it('restores named canvas geometry after reopening and discards only unsaved geometry', async () => {
  const { db, store } = setup();
  await store.recordImport(edit.modelId, 123, source);
  const peer = `peer:${'b'.repeat(64)}`;
  const canvas = {
    positions: { local: { column: 0, row: 0 }, [peer]: { column: -1, row: 0 } },
    links: [{ from: 'local', to: peer, edge: 'left' as const }],
  };
  const input = { ...edit, runs: [{ uuid, first: '0', last: '63' }], canvas };
  const draft = store.cluster.writeDraft(`model:${edit.modelId}`, null, input);
  const saved = store.cluster.saveDraft(draft.key, draft.revision, 'Left worker');
  if (!saved.ok) throw Error('fixture save failed');
  const reopened = new ModelConfigurationStore(
    db,
    () => {},
    () => true,
    capabilities,
    record().load,
  );
  reopened.cluster.clearSessionDrafts();
  expect(reopened.cluster.read(saved.configuration.id)?.canvas).toEqual(canvas);
  const changed = reopened.cluster.writeDraft(saved.draft.key, null, {
    ...edit,
    runs: input.runs,
    canvas: { positions: { local: { column: 0, row: 0 } }, links: [] },
  });
  expect(reopened.cluster.read(saved.configuration.id)?.canvas).toEqual(canvas);
  expect(reopened.cluster.discardDraft(changed.key, changed.revision)?.canvas).toEqual(canvas);
  expect(reopened.cluster.read(saved.configuration.id)?.runs).toEqual([
    { uuid, first: 0, last: 63 },
  ]);
});
it('deletes only the requested saved configuration and its draft, preserving model settings and other drafts', async () => {
  const { store } = setup();
  await store.recordImport(edit.modelId, 123, source);
  const create = (name: string) => {
    const draft = store.cluster.writeDraft(`model:${edit.modelId}`, null, {
      ...edit,
      runs: [{ uuid, first: '0', last: '63' }],
    });
    const saved = store.cluster.saveDraft(draft.key, draft.revision, name);
    if (!saved.ok) throw Error('fixture save failed');
    return saved;
  };
  const first = create('Delete this'),
    second = create('Keep this');
  const modelDraft = store.cluster.writeDraft(`model:${edit.modelId}`, null, edit);
  const settings = await store.read(edit.modelId);
  expect(() =>
    store.cluster.remove(first.configuration.id, first.configuration.revision + 1),
  ).toThrow('STALE_CONFIGURATION');
  expect(store.cluster.read(first.configuration.id)).not.toBeNull();
  store.cluster.remove(first.configuration.id, first.configuration.revision);
  expect(store.cluster.read(first.configuration.id)).toBeNull();
  expect(store.cluster.readDraft(first.draft.key)).toBeNull();
  expect(store.cluster.read(second.configuration.id)).toEqual(second.configuration);
  expect(store.cluster.readDraft(second.draft.key)).toEqual(second.draft);
  expect(store.cluster.readDraft(modelDraft.key)).toEqual(modelDraft);
  expect(await store.read(edit.modelId)).toEqual(settings);
  expect(await store.readImportSource(edit.modelId)).toEqual(source);
});
it('rolls back configuration deletion if removing its draft fails', async () => {
  const { store, db } = setup();
  await store.recordImport(edit.modelId, 123, source);
  const draft = store.cluster.writeDraft(`model:${edit.modelId}`, null, {
    ...edit,
    runs: [{ uuid, first: '0', last: '63' }],
  });
  const saved = store.cluster.saveDraft(draft.key, draft.revision, 'Retain on failure');
  if (!saved.ok) throw Error('fixture save failed');
  db.exec(
    "CREATE TRIGGER fail_delete BEFORE DELETE ON cluster_drafts BEGIN SELECT RAISE(ABORT, 'injected failure'); END",
  );
  expect(() =>
    store.cluster.remove(saved.configuration.id, saved.configuration.revision),
  ).toThrow();
  expect(store.cluster.read(saved.configuration.id)).toEqual(saved.configuration);
  expect(store.cluster.readDraft(saved.draft.key)).toEqual(saved.draft);
});
it('durably retains invalid drafts and promotes only a complete captured revision', async () => {
  const { db, store } = setup();
  await store.recordImport(edit.modelId, 123, source);
  const key = `model:${edit.modelId}`;
  const draft = store.cluster.writeDraft(key, null, edit);
  const reopened = new ModelConfigurationStore(
    db,
    () => {},
    () => true,
    capabilities,
    record().load,
  );
  expect(reopened.cluster.readDraft(key)?.runs[0]?.last).toBe('-');
  expect(reopened.cluster.saveDraft(key, draft.revision, 'Laptop').ok).toBe(false);
  expect(reopened.cluster.list()).toEqual([]);
  const valid = reopened.cluster.writeDraft(key, draft.revision, {
    ...edit,
    runs: [{ uuid, first: '0', last: '63' }],
  });
  const saved = reopened.cluster.saveDraft(key, valid.revision, 'Laptop');
  expect(saved.ok).toBe(true);
  if (!saved.ok) throw Error('fixture save failed');
  expect(saved.configuration.runs).toEqual([{ uuid, first: 0, last: 63 }]);
  expect(saved.draft.baseSavedRevision).toBe(1);
  expect(reopened.cluster.readDraft(key)).toBeNull();
  const dirty = reopened.cluster.writeDraft(saved.draft.key, saved.draft.revision, {
    ...edit,
    runs: [{ uuid, first: '', last: '63' }],
  });
  expect(() => reopened.cluster.saveDraft(dirty.key, saved.draft.revision)).toThrow(
    'STALE_CONFIGURATION',
  );
  expect(reopened.cluster.read(saved.configuration.id)?.runs[0]?.first).toBe(0);
  expect(reopened.cluster.discardDraft(dirty.key, dirty.revision)?.runs[0]?.first).toBe('0');
});
it('migrates schema 3 transactionally and preserves usage and credentials', async () => {
  const { db, store } = setup();
  await store.recordImport(edit.modelId, 123, source);
  await store.recordUse(edit.modelId, 456);
  await store.replaceCredential(0, Buffer.from('protected'));
  db.exec(
    'DROP TABLE cluster_drafts; DROP TABLE cluster_configurations; DROP TABLE configuration_schema; CREATE TABLE configuration_schema(version INTEGER NOT NULL CHECK(version=3)); INSERT INTO configuration_schema VALUES(3)',
  );
  const reopened = new ModelConfigurationStore(
    db,
    () => {},
    () => true,
    capabilities,
    record().load,
  );
  expect(db.prepare('SELECT version FROM configuration_schema').get()?.version).toBe(4);
  expect(await reopened.readUse(edit.modelId)).toBe(456);
  expect((await reopened.readCredential())?.protectedKey).toEqual(Buffer.from('protected'));
  expect((await reopened.readImportSource(edit.modelId))?.blockCount).toBe(64);
});
it('rolls back a failed upgrade without damaging older records', () => {
  const { db } = setup();
  db.exec(
    'DROP TABLE cluster_drafts; DROP TABLE cluster_configurations; DROP TABLE configuration_schema; CREATE TABLE configuration_schema(version INTEGER NOT NULL CHECK(version=3)); INSERT INTO configuration_schema VALUES(3)',
  );
  expect(
    () =>
      new ModelConfigurationStore(
        db,
        () => {
          throw Error('disk unavailable');
        },
        () => true,
        capabilities,
        record().load,
      ),
  ).toThrow('CONFIGURATION_UNAVAILABLE');
  expect(db.prepare('SELECT version FROM configuration_schema').get()?.version).toBe(3);
  expect(
    db.prepare("SELECT name FROM sqlite_schema WHERE name='cluster_drafts'").get(),
  ).toBeUndefined();
});
it('keeps the last acknowledged raw draft on a failed storage reservation', () => {
  const { db, store } = setup();
  const key = `model:${edit.modelId}`;
  const draft = store.cluster.writeDraft(key, null, edit);
  let unavailable = false;
  const reopened = new ModelConfigurationStore(
    db,
    () => {
      if (unavailable) throw Error('disk full');
    },
    () => true,
    capabilities,
    record().load,
  );
  unavailable = true;
  expect(() => reopened.cluster.writeDraft(key, draft.revision, { ...edit, runs: [] })).toThrow(
    'CONFIGURATION_UNAVAILABLE',
  );
  expect(reopened.cluster.readDraft(key)?.runs).toEqual(edit.runs);
});
it('saves only placement and resolves current model settings after they change', async () => {
  const { store, db } = setup();
  await store.recordImport(edit.modelId, 123, source);
  const preferences = {
    ...record().preferences,
    ropeBase: { enabled: true, value: 1000000 },
    reasoningMessage: 'Captured cluster message.',
  };
  const draft = store.cluster.writeDraft(`model:${edit.modelId}`, null, {
    ...edit,
    load: { ...edit.load, preferences },
    runs: [{ uuid, first: '0', last: '63' }],
  });
  const saved = store.cluster.saveDraft(draft.key, draft.revision, 'Captured');
  expect(saved.ok).toBe(true);
  if (!saved.ok) throw Error('fixture save failed');
  const captured = structuredClone(saved.configuration);
  const defaults = await store.read(edit.modelId);
  const committed = await store.save(edit.modelId, defaults.revision, {
    ...defaults,
    load: { ...defaults.load, contextLength: 2048, concurrency: 1 },
    preferences: { ...defaults.preferences, reasoningMessage: 'New model default.' },
  });
  expect(committed.load.contextLength).toBe(2048);
  const persisted = JSON.parse(
    String(
      db
        .prepare('SELECT record FROM cluster_configurations WHERE configuration_id=?')
        .get(captured.id)?.record,
    ),
  ) as Record<string, unknown>;
  expect(persisted).not.toHaveProperty('load');
  const current = store.cluster.read(captured.id)!;
  expect(current.runs).toEqual(captured.runs);
  expect(current.revision).toBe(captured.revision);
  expect(current.load.defaults.contextLength).toBe(2048);
  expect(current.load.preferences?.reasoningMessage).toBe('New model default.');
  expect(store.cluster.readDraft(saved.draft.key)?.load).toEqual(current.load);
  expect(captured.load.defaults.contextLength).not.toBe(2048);
});
it('selects a reimported earlier model as latest without changing its original import time', async () => {
  const { db } = setup();
  const store = new ModelConfigurationStore(
    db,
    () => {},
    () => true,
    capabilities,
    record().load,
  );
  const second = {
    ...source,
    modelId: 'b'.repeat(64),
    file: 'E:\\Models\\second.gguf',
    name: 'Second',
  };
  await store.recordImport(source.modelId, 123, source);
  await store.recordImport(second.modelId, 456, second);
  expect(await store.readLatestImportSource()).toEqual(second);
  const reimported = { ...source, file: 'E:\\Models\\reimported.gguf' };
  expect(await store.recordImport(source.modelId, 789, reimported)).toBe(123);
  expect(await store.readLatestImportSource()).toEqual(reimported);
  expect(await store.readImport(source.modelId)).toBe(123);
  expect(await store.readImport(second.modelId)).toBe(456);
});

async function legacyPlacement() {
  const fixture = setup();
  await fixture.store.recordImport(edit.modelId, 123, source);
  const draft = fixture.store.cluster.writeDraft(`model:${edit.modelId}`, null, {
    ...edit,
    runs: [{ uuid, first: '0', last: '63' }],
  });
  const saved = fixture.store.cluster.saveDraft(draft.key, draft.revision, 'Legacy laptop');
  if (!saved.ok) throw Error('fixture save failed');
  const storedDraft = fixture.store.cluster.writeDraft(saved.draft.key, saved.draft.revision, {
    ...edit,
    runs: [{ uuid, first: '0', last: '62' }],
  });
  const modelDefaults = await fixture.store.read(edit.modelId);
  await fixture.store.save(edit.modelId, modelDefaults.revision, {
    ...modelDefaults,
    generation: { ...modelDefaults.generation, temperature: 0.2 },
  });
  const modelRow = fixture.db
    .prepare('SELECT record FROM model_configurations WHERE model_id=?')
    .get(edit.modelId)?.record;
  for (const table of ['cluster_configurations', 'cluster_drafts']) {
    expect(
      JSON.parse(String(fixture.db.prepare(`SELECT record FROM ${table}`).get()?.record)),
    ).not.toHaveProperty('load');
  }
  const savedJson = JSON.stringify(saved.configuration);
  const draftJson = JSON.stringify(storedDraft);
  fixture.db
    .prepare('UPDATE cluster_configurations SET record=? WHERE configuration_id=?')
    .run(savedJson, saved.configuration.id);
  fixture.db
    .prepare('UPDATE cluster_drafts SET record=? WHERE draft_key=?')
    .run(draftJson, storedDraft.key);
  return { ...fixture, saved, storedDraft, savedJson, draftJson, modelRow };
}

it('strips legacy embedded settings from named placements and drafts without changing their identity or model settings', async () => {
  const fixture = await legacyPlacement();
  const reopened = new ModelConfigurationStore(
    fixture.db,
    () => {},
    () => true,
    capabilities,
    record().load,
  );
  for (const table of ['cluster_configurations', 'cluster_drafts']) {
    const stored: unknown = JSON.parse(
      String(fixture.db.prepare(`SELECT record FROM ${table}`).get()?.record),
    );
    expect(stored).not.toHaveProperty('load');
  }
  const { load: _savedLoad, ...savedPlacement } = fixture.saved.configuration;
  const { load: _draftLoad, ...draftPlacement } = fixture.storedDraft;
  void _savedLoad;
  void _draftLoad;
  expect(reopened.cluster.read(fixture.saved.configuration.id)).toMatchObject(savedPlacement);
  expect(reopened.cluster.readDraft(fixture.storedDraft.key)).toMatchObject(draftPlacement);
  expect(
    fixture.db.prepare('SELECT record FROM model_configurations WHERE model_id=?').get(edit.modelId)
      ?.record,
  ).toBe(fixture.modelRow);
});

it.each(['reservation', 'trigger'] as const)(
  'rolls back all legacy settings removal after %s failure',
  async (failure) => {
    const fixture = await legacyPlacement();
    if (failure === 'trigger')
      fixture.db.exec(
        "CREATE TRIGGER reject_draft_migration BEFORE UPDATE ON cluster_drafts BEGIN SELECT RAISE(ABORT,'fixture failure'); END",
      );
    expect(() => {
      // Inject SQL failure after schema validation so it exercises migration rollback.
      if (failure === 'trigger') fixture.store.cluster.removeEmbeddedSettings();
      else
        new ModelConfigurationStore(
          fixture.db,
          () => {
            if (failure === 'reservation') throw Error('disk full');
          },
          () => true,
          capabilities,
          record().load,
        );
    }).toThrow('CONFIGURATION_UNAVAILABLE');
    expect(fixture.db.prepare('SELECT record FROM cluster_configurations').get()?.record).toBe(
      fixture.savedJson,
    );
    expect(fixture.db.prepare('SELECT record FROM cluster_drafts').get()?.record).toBe(
      fixture.draftJson,
    );
    expect(
      fixture.db
        .prepare('SELECT record FROM model_configurations WHERE model_id=?')
        .get(edit.modelId)?.record,
    ).toBe(fixture.modelRow);
  },
);

it('hydrates reopened placements from changed model defaults and uses f16 values when flash attention is off', async () => {
  const fixture = await legacyPlacement();
  const previous = await fixture.store.read(edit.modelId);
  await fixture.store.save(edit.modelId, previous.revision, {
    ...previous,
    load: { ...previous.load, contextLength: 2048, flashAttention: false },
  });
  const reopened = new ModelConfigurationStore(
    fixture.db,
    () => {},
    () => true,
    capabilities,
    record().load,
    { cacheK: 'q8_0', cacheV: 'q8_0' },
  );
  for (const value of [
    reopened.cluster.read(fixture.saved.configuration.id),
    reopened.cluster.readDraft(fixture.storedDraft.key),
  ]) {
    expect(value?.load.defaults.contextLength).toBe(2048);
    expect(value?.load.defaults.flashAttention).toBe(false);
    expect(value?.load.cacheK).toBe('q8_0');
    expect(value?.load.cacheV).toBe('f16');
  }
});
