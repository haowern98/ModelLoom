import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, renameSync, rmSync, symlinkSync, truncateSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import {
  openConfigurationDirectory,
  openHistoryDirectory,
  trustedHistoryRoot,
} from '../history/windows-directory.js';
import type { HistoryDirectoryGuard } from '../history/windows-directory.js';
import { ModelConfigurationStore, openModelConfigurationStore } from './store.js';
import { capabilities, record } from './test-fixtures.js';

const base = fileURLToPath(new URL('../../out/configuration-fixtures/', import.meta.url));
mkdirSync(base, { recursive: true });
const roots: string[] = [],
  guards: HistoryDirectoryGuard[] = [];
function root() {
  const value = mkdtempSync(path.join(base, 'case-'));
  roots.push(value);
  return value;
}
function open(value: string) {
  const guard = openConfigurationDirectory(trustedHistoryRoot(value));
  guards.push(guard);
  return guard;
}
afterEach(() => {
  guards.splice(0).forEach((guard) => guard.close());
  roots.splice(0).forEach((value) => rmSync(value, { recursive: true, force: true }));
});

it('holds configuration database, journal and directories against pathname replacement', () => {
  const value = root(),
    guard = open(value);
  guard.reserveJournal();
  expect(guard.database).toBe(path.join(value, 'configuration/settings.sqlite'));
  for (const file of [guard.database, guard.journal, path.join(value, 'configuration'), value])
    expect(() => renameSync(file, `${file}-moved`)).toThrow();
});

it('keeps configuration separate while the history guard remains open', () => {
  const value = root(),
    history = openHistoryDirectory(trustedHistoryRoot(value));
  guards.push(history);
  const configuration = open(value);
  expect(configuration.database).not.toBe(history.database);
  const database = new DatabaseSync(configuration.database, { allowExtension: false });
  try {
    database.exec(
      "PRAGMA journal_mode=PERSIST; CREATE TABLE sample(value TEXT); INSERT INTO sample VALUES ('saved')",
    );
    expect(database.prepare('SELECT value FROM sample').get()?.value).toBe('saved');
  } finally {
    database.close();
  }
});

it('rejects linked configuration directories before creating a database outside the managed root', () => {
  const value = root(),
    outside = root();
  symlinkSync(outside, path.join(value, 'configuration'), 'junction');
  expect(() => open(value)).toThrow('CONFIGURATION_UNAVAILABLE');
});

it('rejects a second writer and forged serialized root authority', () => {
  const value = root();
  open(value);
  expect(() => open(value)).toThrow('CONFIGURATION_UNAVAILABLE');
  expect(() => openConfigurationDirectory({ applicationData: value })).toThrow(
    'INVALID_HISTORY_ROOT',
  );
});

it('persists indexed sources and defaults across an actual guarded database restart', async () => {
  const value = root();
  const source = {
    modelId: record().modelId,
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
  const first = openModelConfigurationStore(
    trustedHistoryRoot(value),
    (id) => id === record().modelId,
    capabilities,
    record().load,
  );
  try {
    const initial = await first.store.read(record().modelId);
    await first.store.save(initial.modelId, 0, {
      ...initial,
      generation: { ...initial.generation, temperature: 0.2 },
    });
    await first.store.recordImport(source.modelId, 123, source);
    await first.store.recordUse(source.modelId, 123456789);
  } finally {
    first.close();
  }
  const second = openModelConfigurationStore(
    trustedHistoryRoot(value),
    (id) => id === record().modelId,
    capabilities,
    record().load,
  );
  try {
    const saved = await second.store.read(record().modelId);
    expect(saved.revision).toBe(1);
    expect(saved.generation.temperature).toBe(0.2);
    expect(await second.store.readImportSource(source.modelId)).toEqual(source);
    expect(await second.store.readImport(source.modelId)).toBe(123);
    expect(await second.store.readUse(source.modelId)).toBe(123456789);
  } finally {
    second.close();
  }
});

it('clears unsaved model and named-placement edits on close while preserving explicit saves', async () => {
  const value = root();
  const modelId = record().modelId;
  const first = openModelConfigurationStore(
    trustedHistoryRoot(value),
    () => true,
    capabilities,
    record().load,
  );
  const edit = {
    modelId,
    load: { defaults: record().load, cacheK: 'q8_0' as const, cacheV: 'q8_0' as const },
    runs: [{ uuid: 'GPU-12345678-1234-1234-1234-123456789abc', first: '0', last: '63' }],
  };
  let saved;
  try {
    await first.store.recordImport(modelId, 123, {
      modelId,
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
    });
    const draft = first.store.cluster.writeDraft(`model:${modelId}`, null, edit);
    saved = first.store.cluster.saveDraft(draft.key, draft.revision, 'Keep this placement');
    if (!saved.ok) throw Error('fixture save failed');
    first.store.cluster.writeDraft(saved.draft.key, saved.draft.revision, { ...edit, runs: [] });
    first.store.cluster.writeDraft(`model:${modelId}`, null, edit);
  } finally {
    first.close();
  }
  const guard = open(value);
  const database = new DatabaseSync(guard.database);
  try {
    expect(database.prepare('SELECT COUNT(*) AS count FROM cluster_drafts').get()?.count).toBe(0);
  } finally {
    database.close();
    guard.close();
  }
  const second = openModelConfigurationStore(
    trustedHistoryRoot(value),
    () => true,
    capabilities,
    record().load,
  );
  try {
    expect(second.store.cluster.readDraft(`model:${modelId}`)).toBeNull();
    if (!saved?.ok) throw Error('fixture save failed');
    expect(second.store.cluster.readDraft(saved.draft.key)).toBeNull();
    expect(second.store.cluster.read(saved.configuration.id)).toEqual(saved.configuration);
    expect(await second.store.readImportSource(modelId)).not.toBeNull();
  } finally {
    second.close();
  }
});

it('does not restore leftover drafts from a previous interrupted session', () => {
  const value = root(),
    guard = open(value);
  const database = new DatabaseSync(guard.database);
  const modelId = record().modelId;
  try {
    const previous = new ModelConfigurationStore(
      database,
      () => guard.reserveJournal(),
      () => true,
      capabilities,
      record().load,
    );
    previous.cluster.writeDraft(`model:${modelId}`, null, {
      modelId,
      load: { defaults: record().load, cacheK: 'q8_0', cacheV: 'q8_0' },
      runs: [],
    });
  } finally {
    database.close();
    guard.close();
  }
  const next = openModelConfigurationStore(
    trustedHistoryRoot(value),
    () => true,
    capabilities,
    record().load,
  );
  try {
    expect(next.store.cluster.readDraft(`model:${modelId}`)).toBeNull();
  } finally {
    next.close();
  }
});

it('rejects an oversized settings database without relaxing the separate history quota', () => {
  const value = root(),
    guard = open(value),
    database = guard.database;
  guard.close();
  truncateSync(database, 4 * 1024 * 1024 + 1);
  expect(() => open(value)).toThrow('CONFIGURATION_UNAVAILABLE');
});
