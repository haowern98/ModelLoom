import { afterEach, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { HistoryStore } from './store.js';
import type { BeginTurn, Provenance } from './store.js';
const stores: HistoryStore[] = [],
  databases: DatabaseSync[] = [];
afterEach(() => {
  for (const s of stores.splice(0)) s.close();
  for (const db of databases.splice(0)) if (db.isOpen) db.close();
});
const provenance: Provenance = {
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
};
function setup(reserve?: () => void) {
  const db = new DatabaseSync(':memory:');
  databases.push(db);
  const store = new HistoryStore(db, reserve);
  stores.push(store);
  return { db, store };
}
function input(conversationId: string, suffix = '1'): BeginTurn {
  return {
    conversationId,
    turnId: `turn${suffix}`,
    attemptId: `attempt${suffix}`,
    requestId: `request${suffix}`,
    text: 'Synthetic question',
    provenance,
  };
}
it('deletes only the chosen chat and its attempts atomically, retaining other saved content', async () => {
  const { db, store } = setup();
  const removed = await store.newConversation(),
    kept = await store.newConversation();
  await store.saveDraft(removed.id, 'Removed draft');
  await store.beginTurn(input(removed.id));
  await store.finish(
    'attempt1',
    'Answer',
    { status: 'completed', reason: 'STOP' },
    'Thinking',
    { generation: 20, prefill: 100 },
    1250,
  );
  await store.saveDraft(kept.id, 'Keep this draft');
  const before = await store.readConversation(kept.id),
    version = await store.listRevision();
  await store.deleteConversation(removed.id);
  expect(await store.readConversation(kept.id)).toEqual(before);
  expect((await store.listConversations()).map((c) => c.id)).toEqual([kept.id]);
  expect(await store.listRevision()).not.toBe(version);
  expect(db.prepare('SELECT COUNT(*) AS count FROM attempts').get()?.count).toBe(0);
  expect(db.prepare('SELECT COUNT(*) AS count FROM user_turns').get()?.count).toBe(0);
  await expect(store.readConversation(removed.id)).rejects.toThrow('UNKNOWN_CONVERSATION');
});
it('refuses deletion of active attempts and rolls back child deletion on storage failure', async () => {
  const { db, store } = setup();
  const c = await store.newConversation();
  await store.beginTurn(input(c.id));
  await expect(store.deleteConversation(c.id)).rejects.toThrow('CONVERSATION_BUSY');
  await store.finish('attempt1', 'Saved', { status: 'completed', reason: 'STOP' });
  const before = await store.readConversation(c.id),
    version = await store.listRevision();
  db.exec(
    "CREATE TRIGGER fail_delete BEFORE DELETE ON conversations BEGIN SELECT RAISE(ABORT,'synthetic failure'); END",
  );
  await expect(store.deleteConversation(c.id)).rejects.toThrow('HISTORY_UNAVAILABLE');
  expect(await store.readConversation(c.id)).toEqual(before);
  expect(await store.listRevision()).toBe(version);
});
it('invalidates list cursors even after replacing an empty chat with another empty chat', async () => {
  const { store } = setup();
  const original = await store.newConversation(),
    version = await store.listRevision();
  await store.deleteConversation(original.id);
  await store.newConversation();
  expect(await store.listRevision()).not.toBe(version);
});
it('persists one user turn and attempt before execution and preserves exact provenance', async () => {
  const { store } = setup(),
    c = await store.newConversation();
  await store.beginTurn(input(c.id));
  expect((await store.readConversation(c.id)).turns).toMatchObject([
    {
      text: 'Synthetic question',
      attempts: [{ id: 'attempt1', requestId: 'request1', state: 'queued', text: '', provenance }],
    },
  ]);
});
it('stores drafts without creating generation and returns summaries without history bodies', async () => {
  const { store } = setup(),
    c = await store.newConversation();
  await store.saveDraft(c.id, ' draft ');
  expect(await store.readConversation(c.id)).toMatchObject({ draft: ' draft ', turns: [] });
  expect(await store.listConversations()).toMatchObject([{ id: c.id, turns: [] }]);
});
it('recovers every active attempt as interrupted and preserves committed partial text', async () => {
  const { store } = setup(),
    c = await store.newConversation();
  await store.beginTurn(input(c.id));
  await store.checkpoint('attempt1', 'partial', 'running');
  await store.recoverInterrupted();
  expect((await store.readConversation(c.id)).turns[0]?.attempts[0]).toMatchObject({
    text: 'partial',
    state: 'interrupted',
    outcome: { status: 'interrupted', reason: 'CHANNEL_LOST' },
  });
});
it('retry appends a new attempt to the original user turn without overwriting partial text', async () => {
  const { store } = setup(),
    c = await store.newConversation();
  await store.beginTurn(input(c.id));
  await store.finish('attempt1', 'partial', { status: 'cancelled', reason: 'USER_CANCELLED' });
  await store.retry('attempt1', 'attempt2', 'request2', provenance);
  const result = await store.readConversation(c.id);
  expect(result.turns).toHaveLength(1);
  expect(result.turns[0]?.attempts).toMatchObject([
    { text: 'partial', state: 'cancelled' },
    { text: '', state: 'queued' },
  ]);
});
it('terminal persistence is idempotent only for the same text and outcome', async () => {
  const { store } = setup(),
    c = await store.newConversation();
  await store.beginTurn(input(c.id));
  const outcome = { status: 'completed', reason: 'STOP' } as const;
  await store.finish('attempt1', 'answer', outcome);
  const revision = (await store.readConversation(c.id)).revision;
  await store.finish('attempt1', 'answer', outcome);
  expect((await store.readConversation(c.id)).revision).toBe(revision);
  await expect(store.finish('attempt1', 'changed', outcome)).rejects.toThrow('INVALID_TRANSITION');
  await expect(store.checkpoint('attempt1', 'late', 'running')).rejects.toThrow(
    'INVALID_TRANSITION',
  );
});
it('persists measured speeds with the final response, retaining them on reopen and retry', async () => {
  const { db, store } = setup(),
    c = await store.newConversation();
  await store.beginTurn(input(c.id));
  const outcome = { status: 'completed', reason: 'STOP' } as const;
  const speeds = { generation: 24.8, prefill: 1420 };
  await store.finish('attempt1', 'answer', outcome, 'thinking', speeds);
  const reopened = new HistoryStore(db);
  expect((await reopened.readConversation(c.id)).turns[0]?.attempts[0]).toMatchObject({
    text: 'answer',
    reasoning: 'thinking',
    speeds,
  });
  const revision = (await reopened.readConversation(c.id)).revision;
  await reopened.finish('attempt1', 'answer', outcome, 'thinking', speeds);
  expect((await reopened.readConversation(c.id)).revision).toBe(revision);
  await expect(
    reopened.finish('attempt1', 'answer', outcome, 'thinking', { ...speeds, generation: 1 }),
  ).rejects.toThrow('INVALID_TRANSITION');
  await reopened.retry('attempt1', 'attempt2', 'request2', provenance);
  const attempts = (await reopened.readConversation(c.id)).turns[0]!.attempts;
  expect(attempts[0]?.speeds).toEqual(speeds);
  expect(attempts[1]?.speeds).toBeUndefined();
});
it.each([
  { generation: -1, prefill: 2 },
  { generation: 'forged', prefill: 2 },
  { generation: 1, prefill: 2, path: 'forged' },
])('rejects invalid saved speed data without changing the response', async (speeds) => {
  const { store } = setup(),
    c = await store.newConversation();
  await store.beginTurn(input(c.id));
  await expect(
    store.finish(
      'attempt1',
      'answer',
      { status: 'completed', reason: 'STOP' },
      '',
      speeds as never,
    ),
  ).rejects.toThrow('INVALID_HISTORY');
  expect((await store.readConversation(c.id)).turns[0]?.attempts[0]?.state).toBe('queued');
});
it('rolls back duplicate request IDs without duplicating user turns', async () => {
  const { store } = setup(),
    c = await store.newConversation();
  await store.beginTurn(input(c.id));
  await store.finish('attempt1', 'answer', { status: 'completed', reason: 'STOP' });
  await expect(store.beginTurn({ ...input(c.id, '2'), requestId: 'request1' })).rejects.toThrow(
    'INVALID_HISTORY',
  );
  expect((await store.readConversation(c.id)).turns).toHaveLength(1);
});
it('rejects concurrent work in the same conversation before adding a turn', async () => {
  const { store } = setup(),
    c = await store.newConversation();
  await store.beginTurn(input(c.id));
  await expect(store.beginTurn(input(c.id, '2'))).rejects.toThrow('CONVERSATION_BUSY');
  expect((await store.readConversation(c.id)).turns).toHaveLength(1);
});
it('storage reservation failure leaves no new turn and leaks no private error', async () => {
  let fail = false;
  const { store } = setup(() => {
    if (fail) throw new Error('private disk path');
  });
  const c = await store.newConversation();
  fail = true;
  await expect(store.beginTurn(input(c.id))).rejects.toThrow('HISTORY_UNAVAILABLE');
  expect((await store.readConversation(c.id)).turns).toHaveLength(0);
});
it('rejects oversized text, malformed outcomes and secrets in configuration without a write', async () => {
  const { store } = setup(),
    c = await store.newConversation();
  await expect(store.beginTurn({ ...input(c.id), text: 'x'.repeat(12001) })).rejects.toThrow(
    'INVALID_HISTORY',
  );
  await expect(
    store.beginTurn({
      ...input(c.id),
      provenance: {
        ...provenance,
        configuration: {
          ...provenance.configuration,
          credential: 'private',
        } as typeof provenance.configuration,
      },
    }),
  ).rejects.toThrow('INVALID_HISTORY');
  await store.beginTurn(input(c.id));
  await expect(
    store.finish('attempt1', 'x', { status: 'completed', reason: 'INVALID_STREAM' } as never),
  ).rejects.toThrow('INVALID_HISTORY');
  await expect(
    store.checkpoint('attempt1', 'x'.repeat(1024 * 1024 + 1), 'running'),
  ).rejects.toThrow('HISTORY_FULL');
});
it('preserves unknown schema versions without migration or recovery writes', () => {
  const db = new DatabaseSync(':memory:');
  databases.push(db);
  db.exec('CREATE TABLE schema_version(version INTEGER); INSERT INTO schema_version VALUES(2);');
  expect(() => new HistoryStore(db)).toThrow('UNSUPPORTED_HISTORY');
  expect(db.prepare('SELECT version FROM schema_version').get()).toEqual({ version: 2 });
});
function legacyDatabase() {
  const db = new DatabaseSync(':memory:');
  databases.push(db);
  db.exec(`CREATE TABLE schema_version(version INTEGER NOT NULL CHECK(version=1));
CREATE TABLE conversations(id TEXT PRIMARY KEY NOT NULL,title TEXT NOT NULL,draft TEXT NOT NULL,created INTEGER NOT NULL,updated INTEGER NOT NULL,revision INTEGER NOT NULL CHECK(revision>=0));
CREATE TABLE user_turns(id TEXT PRIMARY KEY NOT NULL,conversation_id TEXT NOT NULL REFERENCES conversations(id),ordinal INTEGER NOT NULL,text TEXT NOT NULL,created INTEGER NOT NULL,UNIQUE(conversation_id,ordinal));
CREATE TABLE attempts(id TEXT PRIMARY KEY NOT NULL,turn_id TEXT NOT NULL REFERENCES user_turns(id),ordinal INTEGER NOT NULL,request_id TEXT UNIQUE NOT NULL,state TEXT NOT NULL,text TEXT NOT NULL,reason TEXT,created INTEGER NOT NULL,updated INTEGER NOT NULL,provenance TEXT NOT NULL,UNIQUE(turn_id,ordinal));
INSERT INTO schema_version VALUES(1);
INSERT INTO conversations VALUES('old','Saved title','Saved draft',1,2,3);
INSERT INTO user_turns VALUES('turn','old',0,'Saved question',1);`);
  db.prepare('INSERT INTO attempts VALUES(?,?,?,?,?,?,?,?,?,?)').run(
    'attempt',
    'turn',
    0,
    'request',
    'completed',
    'Saved answer',
    'STOP',
    1,
    2,
    JSON.stringify(provenance),
  );
  return db;
}
function thinkingDatabase() {
  const db = legacyDatabase();
  db.exec(
    "ALTER TABLE attempts ADD COLUMN reasoning TEXT NOT NULL DEFAULT ''; UPDATE attempts SET reasoning='Saved thinking'; DROP TABLE schema_version; CREATE TABLE schema_version(version INTEGER NOT NULL CHECK(version=2)); INSERT INTO schema_version VALUES(2);",
  );
  return db;
}
function speedsDatabase() {
  const db = thinkingDatabase();
  db.exec(
    'ALTER TABLE attempts ADD COLUMN speeds TEXT; DROP TABLE schema_version; CREATE TABLE schema_version(version INTEGER NOT NULL CHECK(version=3)); INSERT INTO schema_version VALUES(3);',
  );
  db.prepare('UPDATE attempts SET speeds=?').run(
    JSON.stringify({ generation: 24.8, prefill: 1420 }),
  );
  return db;
}
it.each([1, 2, 3])(
  'upgrades only the exact version-%i schema and preserves every saved field',
  async (version) => {
    const db =
      version === 1 ? legacyDatabase() : version === 2 ? thinkingDatabase() : speedsDatabase();
    const before = db.prepare('SELECT * FROM attempts').all();
    const store = new HistoryStore(db);
    stores.push(store);
    expect(db.prepare('SELECT version FROM schema_version').get()).toEqual({ version: 4 });
    expect(db.prepare('SELECT * FROM attempts').all()).toMatchObject(before);
    expect(await store.readConversation('old')).toMatchObject({
      title: 'Saved title',
      draft: 'Saved draft',
      revision: 3,
      turns: [
        {
          text: 'Saved question',
          attempts: [
            {
              id: 'attempt',
              text: 'Saved answer',
              reasoning: version === 1 ? '' : 'Saved thinking',
              state: 'completed',
              provenance,
            },
          ],
        },
      ],
    });
    expect((await store.readConversation('old')).turns[0]?.attempts[0]?.speeds).toEqual(
      version === 3 ? { generation: 24.8, prefill: 1420 } : undefined,
    );
    expect((await store.readConversation('old')).turns[0]?.attempts[0]?.thinkingMs).toBeUndefined();
    // A second open must recognize the upgraded schema without applying another migration.
    const second = new HistoryStore(db);
    expect((await second.readConversation('old')).revision).toBe(3);
  },
);
it.each([1, 2, 3])(
  'rolls back a version-%i migration failure without changing the old schema or saved chats',
  (version) => {
    const db =
      version === 1 ? legacyDatabase() : version === 2 ? thinkingDatabase() : speedsDatabase();
    const original = db.exec.bind(db);
    const before = db.prepare('SELECT name,sql FROM sqlite_schema ORDER BY name').all();
    db.exec = (sql: string) => {
      original(sql);
      if (sql.startsWith('ALTER TABLE attempts')) throw new Error('synthetic migration failure');
    };
    expect(() => new HistoryStore(db)).toThrow('HISTORY_UNAVAILABLE');
    expect(db.prepare('SELECT name,sql FROM sqlite_schema ORDER BY name').all()).toEqual(before);
    expect(db.prepare('SELECT version FROM schema_version').get()).toEqual({ version });
    expect(db.prepare('SELECT text FROM attempts').get()).toEqual({ text: 'Saved answer' });
  },
);
it('checkpoints a finished thinking duration, preserves it through recovery and rejects rewrites', async () => {
  const { db, store } = setup(),
    c = await store.newConversation();
  await store.beginTurn(input(c.id));
  await store.checkpoint('attempt1', 'Answer', 'running', 'Think', 12500);
  await expect(store.checkpoint('attempt1', 'Answer', 'running', 'Think', -1)).rejects.toThrow(
    'INVALID_HISTORY',
  );
  await expect(store.checkpoint('attempt1', 'Answer', 'running', 'Think', 1.5)).rejects.toThrow(
    'INVALID_HISTORY',
  );
  await expect(store.checkpoint('attempt1', 'Answer', 'running', 'Think', 13000)).rejects.toThrow(
    'INVALID_TRANSITION',
  );
  await store.recoverInterrupted();
  const reopened = new HistoryStore(db);
  expect((await reopened.readConversation(c.id)).turns[0]?.attempts[0]).toMatchObject({
    thinkingMs: 12500,
    state: 'interrupted',
  });
});
it('preserves thinking through checkpoints/recovery and enforces shared byte and append limits', async () => {
  const { store } = setup(),
    c = await store.newConversation();
  await store.beginTurn(input(c.id));
  await store.checkpoint('attempt1', 'answer', 'running', 'think');
  await expect(store.checkpoint('attempt1', 'answer', 'running', 'changed')).rejects.toThrow(
    'INVALID_TRANSITION',
  );
  await expect(
    store.checkpoint('attempt1', 'answer', 'running', 'think' + 'x'.repeat(1024 * 1024)),
  ).rejects.toThrow('HISTORY_FULL');
  await store.recoverInterrupted();
  expect((await store.readConversation(c.id)).turns[0]?.attempts[0]).toMatchObject({
    text: 'answer',
    reasoning: 'think',
    state: 'interrupted',
  });
});
it('rejects unrecognized existing schema without replacing it', () => {
  const db = new DatabaseSync(':memory:');
  databases.push(db);
  db.exec("CREATE TABLE original(value TEXT); INSERT INTO original VALUES('sentinel');");
  expect(() => new HistoryStore(db)).toThrow('UNSUPPORTED_HISTORY');
  expect(db.prepare('SELECT value FROM original').get()).toEqual({ value: 'sentinel' });
});
it('does not expose native database errors or unknown attempt IDs', async () => {
  const { store } = setup();
  await expect(store.readConversation('unknown')).rejects.toThrow('UNKNOWN_CONVERSATION');
  await expect(
    store.finish('unknown', '', { status: 'completed', reason: 'STOP' }),
  ).rejects.toThrow('UNKNOWN_ATTEMPT');
});
it('rolls back actual SQLite page exhaustion while preserving the existing conversation', async () => {
  const { db, store } = setup(),
    c = await store.newConversation();
  const pages = db.prepare('PRAGMA page_count').get()?.page_count;
  if (typeof pages !== 'number') throw new Error('Invalid fixture database');
  db.exec(`PRAGMA max_page_count=${pages}`);
  await expect(store.beginTurn({ ...input(c.id), text: 'x'.repeat(12000) })).rejects.toThrow(
    'HISTORY_FULL',
  );
  expect((await store.readConversation(c.id)).turns).toHaveLength(0);
});
it('rejects a conversation that would exceed its text quota without discarding earlier replies', async () => {
  const { store } = setup(),
    c = await store.newConversation();
  for (let index = 0; index < 7; index++) {
    await store.beginTurn(input(c.id, String(index)));
    await store.finish(`attempt${index}`, 'x'.repeat(1024 * 1024), {
      status: 'completed',
      reason: 'STOP',
    });
  }
  await store.beginTurn(input(c.id, 'last'));
  await expect(
    store.finish('attemptlast', 'x'.repeat(1024 * 1024), { status: 'completed', reason: 'STOP' }),
  ).rejects.toThrow('HISTORY_FULL');
  expect((await store.readConversation(c.id)).turns[0]?.attempts[0]?.text.length).toBe(1024 * 1024);
  expect((await store.readConversation(c.id)).turns[7]?.attempts[0]).toMatchObject({
    state: 'queued',
    text: '',
  });
});
