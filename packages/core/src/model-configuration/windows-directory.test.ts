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
import { openModelConfigurationStore } from './store.js';
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
  } finally {
    second.close();
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
