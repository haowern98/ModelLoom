import { afterEach, expect, it } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  linkSync,
  symlinkSync,
  renameSync,
  statSync,
  readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { openHistoryDirectory, trustedHistoryRoot } from './windows-directory.js';
import type { HistoryDirectoryGuard } from './windows-directory.js';
import { openHistoryStore } from './store.js';

const roots: string[] = [],
  guards: HistoryDirectoryGuard[] = [];
function root() {
  const value = mkdtempSync(path.join(tmpdir(), 'modelloom-history-'));
  roots.push(value);
  return value;
}
function open(value: string) {
  const guard = openHistoryDirectory(trustedHistoryRoot(value));
  guards.push(guard);
  return guard;
}
afterEach(() => {
  for (const guard of guards.splice(0)) guard.close();
  for (const value of roots.splice(0)) rmSync(value, { recursive: true, force: true });
});

it('creates a private app root beneath retained ancestors and persists its first draft', async () => {
  const value = path.join(root(), '.modelloom');
  const opened = await openHistoryStore(trustedHistoryRoot(value));
  try {
    const conversation = await opened.store.newConversation();
    await opened.store.saveDraft(conversation.id, 'First draft');
    expect((await opened.store.readConversation(conversation.id)).draft).toBe('First draft');
    expect(() => renameSync(value, `${value}-moved`)).toThrow();
    const acl = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        '[IO.Directory]::GetAccessControl($env:MODELLOOM_TEST_FILE).AreAccessRulesProtected',
      ],
      { encoding: 'utf8', env: { ...process.env, MODELLOOM_TEST_FILE: value } },
    );
    expect(acl.trim()).toBe('True');
  } finally {
    opened.close();
  }
  const reopened = await openHistoryStore(trustedHistoryRoot(value));
  try {
    expect((await reopened.store.listConversations())[0]?.draft).toBe('First draft');
  } finally {
    reopened.close();
  }
});
it('rejects a linked app root before creating chat files in its target', () => {
  const value = path.join(root(), '.modelloom'),
    outside = root();
  symlinkSync(outside, value, 'junction');
  expect(() => open(value)).toThrow('HISTORY_UNAVAILABLE');
  expect(() => statSync(path.join(outside, 'chat'))).toThrow();
});

// A missing native rename lock would let SQLite's captured pathname be redirected.
it('holds database, journal, managed directory and mutable ancestors against rename', () => {
  const value = root(),
    guard = open(value);
  for (const file of [guard.database, guard.journal, path.join(value, 'chat'), value])
    expect(() => renameSync(file, `${file}-moved`)).toThrow();
  guard.close();
  renameSync(path.join(value, 'chat'), path.join(value, 'released'));
});
it('permits actual SQLite PERSIST writes through the retained files', () => {
  const guard = open(root());
  guard.reserveJournal();
  const database = new DatabaseSync(guard.database, { allowExtension: false });
  try {
    database.exec(
      "PRAGMA journal_mode=PERSIST; PRAGMA locking_mode=EXCLUSIVE; CREATE TABLE sample(text TEXT); INSERT INTO sample VALUES ('synthetic');",
    );
    expect(database.prepare('SELECT text FROM sample').get()).toEqual({ text: 'synthetic' });
    expect(statSync(guard.journal).size).toBeLessThanOrEqual(136 * 1024 * 1024);
  } finally {
    database.close();
  }
});
it('rejects a serialized root that attempts to manufacture authority', () => {
  expect(() => openHistoryDirectory({ ...trustedHistoryRoot(root()) })).toThrow(
    'INVALID_HISTORY_ROOT',
  );
});
it('rejects a managed directory junction before writing outside the root', () => {
  const value = root(),
    outside = root();
  symlinkSync(outside, path.join(value, 'chat'), 'junction');
  expect(() => open(value)).toThrow('HISTORY_UNAVAILABLE');
  expect(() => statSync(path.join(outside, 'history.sqlite'))).toThrow();
});
it('rejects a hard-linked existing database and preserves its original content', () => {
  const value = root(),
    outside = root(),
    original = path.join(outside, 'original');
  mkdirSync(path.join(value, 'chat'));
  writeFileSync(original, 'sentinel');
  linkSync(original, path.join(value, 'chat/history.sqlite'));
  expect(() => open(value)).toThrow('HISTORY_UNAVAILABLE');
  expect(readFileSync(original, 'utf8')).toBe('sentinel');
});
it('does not propagate managed permissions through a rejected hard link', () => {
  const value = root(),
    outside = root(),
    original = path.join(outside, 'original');
  mkdirSync(path.join(value, 'chat'));
  writeFileSync(original, 'sentinel');
  linkSync(original, path.join(value, 'chat/history.sqlite'));
  const acl = () =>
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        '[IO.File]::GetAccessControl($env:MODELLOOM_TEST_FILE).GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access)',
      ],
      { encoding: 'utf8', env: { ...process.env, MODELLOOM_TEST_FILE: original } },
    );
  const before = acl();
  expect(() => open(value)).toThrow('HISTORY_UNAVAILABLE');
  expect(acl()).toBe(before);
});
it.each(['history.sqlite-wal', 'history.sqlite-shm', 'unexpected'])(
  'rejects unknown entry %s without deleting it',
  (name) => {
    const value = root();
    mkdirSync(path.join(value, 'chat'));
    writeFileSync(path.join(value, 'chat', name), 'sentinel');
    expect(() => open(value)).toThrow('HISTORY_UNAVAILABLE');
    expect(readFileSync(path.join(value, 'chat', name), 'utf8')).toBe('sentinel');
  },
);
it('rejects a competing guarded writer', () => {
  const value = root();
  open(value);
  expect(() => open(value)).toThrow('HISTORY_UNAVAILABLE');
});
it('rejects invalid roots and oversized existing files before any SQLite write', () => {
  expect(() => trustedHistoryRoot('relative')).toThrow('INVALID_HISTORY_ROOT');
  const value = root();
  mkdirSync(path.join(value, 'chat'));
  mkdirSync(path.join(value, 'chat/history.sqlite'));
  expect(() => open(value)).toThrow('HISTORY_UNAVAILABLE');
});
it('reopens real guarded history and interrupts a committed partial reply without replay', async () => {
  const value = root();
  const first = await openHistoryStore(trustedHistoryRoot(value));
  try {
    const c = await first.store.newConversation();
    await first.store.beginTurn({
      conversationId: c.id,
      turnId: 'turn1',
      attemptId: 'attempt1',
      requestId: 'request1',
      text: 'Synthetic question',
      provenance: {
        packageId: 'runtime1',
        upstreamCommit: 'a'.repeat(40),
        configuration: {
          modelSha256: 'b'.repeat(64),
          contextPerSlot: 7680,
          slots: 4,
          gpuLayers: 99,
          cacheK: 'q8_0',
          cacheV: 'q8_0',
          seed: 7,
          temperature: 0.8,
        },
      },
    });
    await first.store.checkpoint('attempt1', 'partial', 'running');
    first.close();
    const second = await openHistoryStore(trustedHistoryRoot(value));
    try {
      expect((await second.store.readConversation(c.id)).turns[0]?.attempts[0]).toMatchObject({
        text: 'partial',
        state: 'interrupted',
      });
    } finally {
      second.close();
    }
  } finally {
    first.close();
  }
});
it('preserves corrupt database bytes and releases failed acquisition for explicit recovery', async () => {
  const value = root();
  mkdirSync(path.join(value, 'chat'));
  const file = path.join(value, 'chat/history.sqlite');
  writeFileSync(file, 'corrupt sentinel');
  await expect(openHistoryStore(trustedHistoryRoot(value))).rejects.toThrow('HISTORY_UNAVAILABLE');
  expect(readFileSync(file, 'utf8')).toBe('corrupt sentinel');
  renameSync(file, `${file}-preserved`);
});
it('rejects an existing WAL-format database before opening new sidecars or changing its bytes', async () => {
  const value = root();
  const initial = await openHistoryStore(trustedHistoryRoot(value));
  initial.close();
  const file = path.join(value, 'chat/history.sqlite');
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode=WAL');
  db.close();
  const before = readFileSync(file);
  await expect(
    openHistoryStore(trustedHistoryRoot(value)).then((opened) => {
      opened.close();
      return opened;
    }),
  ).rejects.toThrow('HISTORY_UNAVAILABLE');
  expect(readFileSync(file)).toEqual(before);
  expect(() => statSync(`${file}-wal`)).toThrow();
});
it('preserves an unknown database with a hot rollback journal instead of implicitly repairing it', async () => {
  const value = root();
  mkdirSync(path.join(value, 'chat'));
  const file = path.join(value, 'chat/history.sqlite');
  const child = spawnSync(
    process.execPath,
    [
      '-e',
      "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(process.env.MODELLOOM_TEST_FILE);db.exec('PRAGMA journal_mode=PERSIST;CREATE TABLE original(data BLOB);PRAGMA cache_size=10;BEGIN IMMEDIATE');for(let i=0;i<200;i++)db.prepare('INSERT INTO original VALUES(?)').run(Buffer.alloc(8192,7));process.exit(23)",
    ],
    { env: { ...process.env, MODELLOOM_TEST_FILE: file }, stdio: 'ignore' },
  );
  expect(child.status).toBe(23);
  expect(statSync(`${file}-journal`).size).toBeGreaterThan(512);
  const digest = (location: string) =>
    createHash('sha256').update(readFileSync(location)).digest('hex');
  const before = digest(file),
    journalBefore = digest(`${file}-journal`);
  await expect(openHistoryStore(trustedHistoryRoot(value))).rejects.toThrow('HISTORY_UNAVAILABLE');
  expect(digest(file)).toBe(before);
  expect(digest(`${file}-journal`)).toBe(journalBefore);
});
