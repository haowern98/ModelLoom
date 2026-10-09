import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { decodeOutcome, decodeSpeeds, GENERATION_LIMITS } from '../generation/contracts.js';
import type { GenerationSpeeds, TerminalOutcome } from '../generation/contracts.js';
import type { RuntimeConfiguration } from '../runtime/preflight.js';
import { checkResources } from '../runtime/preflight.js';
import { openHistoryDirectory } from './windows-directory.js';
import type { TrustedHistoryRoot } from './windows-directory.js';
export interface Provenance {
  readonly packageId: string;
  readonly upstreamCommit: string;
  readonly configuration: RuntimeConfiguration;
}
export interface Attempt {
  readonly id: string;
  readonly requestId: string;
  readonly turnId: string;
  readonly text: string;
  readonly reasoning: string;
  readonly speeds?: GenerationSpeeds;
  readonly thinkingMs?: number;
  readonly state: string;
  readonly outcome: TerminalOutcome | null;
  readonly provenance: Provenance;
}
export interface Turn {
  readonly id: string;
  readonly text: string;
  readonly attempts: readonly Attempt[];
}
export interface Conversation {
  readonly id: string;
  readonly title: string;
  readonly draft: string;
  readonly revision: number;
  readonly updated: number;
  readonly turns: readonly Turn[];
}
export interface BeginTurn {
  readonly conversationId: string;
  readonly turnId: string;
  readonly attemptId: string;
  readonly requestId: string;
  readonly text: string;
  readonly provenance: Provenance;
}
const active = ['queued', 'running', 'cancelling'];
const legacyTables = {
  schema_version: 'CREATE TABLE schema_version(version INTEGER NOT NULL CHECK(version=1))',
  conversations:
    'CREATE TABLE conversations(id TEXT PRIMARY KEY NOT NULL,title TEXT NOT NULL,draft TEXT NOT NULL,created INTEGER NOT NULL,updated INTEGER NOT NULL,revision INTEGER NOT NULL CHECK(revision>=0))',
  user_turns:
    'CREATE TABLE user_turns(id TEXT PRIMARY KEY NOT NULL,conversation_id TEXT NOT NULL REFERENCES conversations(id),ordinal INTEGER NOT NULL,text TEXT NOT NULL,created INTEGER NOT NULL,UNIQUE(conversation_id,ordinal))',
  attempts:
    'CREATE TABLE attempts(id TEXT PRIMARY KEY NOT NULL,turn_id TEXT NOT NULL REFERENCES user_turns(id),ordinal INTEGER NOT NULL,request_id TEXT UNIQUE NOT NULL,state TEXT NOT NULL,text TEXT NOT NULL,reason TEXT,created INTEGER NOT NULL,updated INTEGER NOT NULL,provenance TEXT NOT NULL,UNIQUE(turn_id,ordinal))',
};
const thinkingTables = {
  ...legacyTables,
  schema_version: 'CREATE TABLE schema_version(version INTEGER NOT NULL CHECK(version=2))',
  attempts: legacyTables.attempts.replace(
    ',UNIQUE(turn_id,ordinal)',
    ", reasoning TEXT NOT NULL DEFAULT '',UNIQUE(turn_id,ordinal)",
  ),
};
const speedsTables = {
  ...thinkingTables,
  schema_version: 'CREATE TABLE schema_version(version INTEGER NOT NULL CHECK(version=3))',
  attempts: thinkingTables.attempts.replace(
    ',UNIQUE(turn_id,ordinal)',
    ', speeds TEXT,UNIQUE(turn_id,ordinal)',
  ),
};
const tables = {
  ...speedsTables,
  schema_version: 'CREATE TABLE schema_version(version INTEGER NOT NULL CHECK(version=4))',
  attempts: speedsTables.attempts.replace(
    ',UNIQUE(turn_id,ordinal)',
    ', thinking_ms INTEGER,UNIQUE(turn_id,ordinal)',
  ),
};
const safeErrors = new Set([
  'INVALID_HISTORY',
  'UNSUPPORTED_HISTORY',
  'HISTORY_FULL',
  'HISTORY_UNAVAILABLE',
  'UNKNOWN_CONVERSATION',
  'UNKNOWN_ATTEMPT',
  'CONVERSATION_BUSY',
  'INVALID_TRANSITION',
]);
type Row = Record<string, unknown>;
function id(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z0-9_-]{1,128}$/u.test(value) ||
    ['constructor', 'prototype', '__proto__'].includes(value)
  )
    throw new Error('INVALID_HISTORY');
  return value;
}
function text(value: unknown, maximum: number): string {
  if (
    typeof value !== 'string' ||
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)
  )
    throw new Error('INVALID_HISTORY');
  if (Buffer.byteLength(value) > maximum) throw new Error('HISTORY_FULL');
  return value;
}
function inputText(value: unknown, blank: boolean): string {
  const result = text(value, 48000);
  if (result.length > 12000 || (!blank && !result.trim())) throw new Error('INVALID_HISTORY');
  return result;
}
function provenance(value: Provenance): Provenance {
  if (
    !value ||
    Object.keys(value).sort().join(',') !== 'configuration,packageId,upstreamCommit' ||
    !/^[a-f0-9]{40}$/u.test(value.upstreamCommit)
  )
    throw new Error('INVALID_HISTORY');
  id(value.packageId);
  const cfg = value.configuration;
  const keys = [
    'modelSha256',
    'contextPerSlot',
    'slots',
    'gpuLayers',
    'cacheK',
    'cacheV',
    'seed',
    'temperature',
    ...(cfg.gpuDevice === undefined ? [] : ['gpuDevice']),
  ].sort();
  if (
    Object.keys(cfg).sort().join(',') !== keys.join(',') ||
    checkResources(cfg, 'history', 'cpu', undefined, { ram: 0, vram: 0 }).code ===
      'INVALID_CONFIGURATION'
  )
    throw new Error('INVALID_HISTORY');
  return Object.freeze({
    packageId: value.packageId,
    upstreamCommit: value.upstreamCommit,
    configuration: Object.freeze(structuredClone(cfg)),
  });
}
function field(row: Row, name: string): string {
  if (typeof row[name] !== 'string') throw new Error('UNSUPPORTED_HISTORY');
  return row[name];
}
function integer(row: Row, name: string): number {
  const value = row[name];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new Error('UNSUPPORTED_HISTORY');
  return value;
}
function outcome(value: unknown): TerminalOutcome {
  try {
    return decodeOutcome(value);
  } catch {
    throw new Error('INVALID_HISTORY');
  }
}
function speeds(value: unknown): GenerationSpeeds {
  try {
    return decodeSpeeds(value);
  } catch {
    throw new Error('INVALID_HISTORY');
  }
}
function duration(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new Error('INVALID_HISTORY');
  return value;
}

function inspectSchema(database: DatabaseSync) {
  const rows = database
    .prepare("SELECT name,sql FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all();
  if (rows.length) {
    const versions = rows.some((row) => row.name === 'schema_version')
      ? database.prepare('SELECT version FROM schema_version').all()
      : [];
    const expected =
      versions[0]?.version === 1
        ? legacyTables
        : versions[0]?.version === 2
          ? thinkingTables
          : versions[0]?.version === 3
            ? speedsTables
            : tables;
    if (
      versions.length !== 1 ||
      (versions[0]?.version !== 1 &&
        versions[0]?.version !== 2 &&
        versions[0]?.version !== 3 &&
        versions[0]?.version !== 4) ||
      rows.length !== 4 ||
      rows.some(
        (row) =>
          typeof row.name !== 'string' ||
          !Object.hasOwn(expected, row.name) ||
          Reflect.get(expected, row.name) !== row.sql,
      ) ||
      database
        .prepare(
          "SELECT name FROM sqlite_schema WHERE type IN ('trigger','view') OR (type='index' AND sql IS NOT NULL)",
        )
        .all().length
    )
      throw new Error('UNSUPPORTED_HISTORY');
    if (database.prepare('PRAGMA page_size').get()?.page_size !== 4096)
      throw new Error('UNSUPPORTED_HISTORY');
    if (
      database
        .prepare('PRAGMA integrity_check')
        .all()
        .some((row) => row.integrity_check !== 'ok') ||
      database.prepare('PRAGMA foreign_key_check').all().length
    )
      throw new Error('UNSUPPORTED_HISTORY');
  }
  return rows;
}

/** Single utility-core writer. The injected connection/reservation are trusted host capabilities,
 * never renderer input. Transactions reserve journal space and check quotas before committing.
 */
export class HistoryStore {
  private closed = false;
  private deletionRevision = 0;
  constructor(
    private readonly database: DatabaseSync,
    private readonly reserve: () => void = () => undefined,
  ) {
    this.safe(() => {
      database.exec(
        'PRAGMA trusted_schema=OFF; PRAGMA foreign_keys=ON; PRAGMA temp_store=MEMORY; PRAGMA busy_timeout=0;',
      );
      // Literal Unicode case-insensitive search; user text never becomes SQL or a LIKE pattern.
      database.function(
        'chat_contains',
        { deterministic: true, directOnly: true },
        (body, query) =>
          typeof body === 'string' &&
          typeof query === 'string' &&
          body.toLowerCase().includes(query.toLowerCase())
            ? 1
            : 0,
      );
      const rows = inspectSchema(database);
      database.exec(
        'PRAGMA page_size=4096; PRAGMA cache_spill=OFF; PRAGMA synchronous=FULL; PRAGMA journal_mode=PERSIST; PRAGMA locking_mode=EXCLUSIVE; PRAGMA max_page_count=30720;',
      );
      if (!rows.length)
        this.transaction(() => {
          for (const sql of Object.values(tables)) database.exec(sql);
          database.exec('INSERT INTO schema_version VALUES(4)');
        });
      // Acquire and retain the exclusive SQLite lock even for an existing idle database.
      else
        this.transaction(() => {
          // Upgrade only preflight-verified schemas, atomically under the retained writer lock.
          const version = database.prepare('SELECT version FROM schema_version').get()?.version;
          if (version === 1 || version === 2 || version === 3) {
            if (version === 1)
              database.exec("ALTER TABLE attempts ADD COLUMN reasoning TEXT NOT NULL DEFAULT ''");
            if (version === 1 || version === 2)
              database.exec('ALTER TABLE attempts ADD COLUMN speeds TEXT');
            database.exec('ALTER TABLE attempts ADD COLUMN thinking_ms INTEGER');
            database.exec('DROP TABLE schema_version');
            database.exec(tables.schema_version);
            database.exec('INSERT INTO schema_version VALUES(4)');
            inspectSchema(database);
          }
        });
    });
  }
  private safe<T>(work: () => T): T {
    if (this.closed) throw new Error('HISTORY_UNAVAILABLE');
    try {
      return work();
    } catch (error) {
      if (error instanceof Error && safeErrors.has(error.message)) throw error;
      if (error && typeof error === 'object' && 'errcode' in error && error.errcode === 13)
        return storageFailure('HISTORY_FULL');
      return storageFailure('HISTORY_UNAVAILABLE');
    }
  }
  private run<T>(work: () => T): Promise<T> {
    return Promise.resolve().then(() => this.safe(work));
  }
  private transaction<T>(work: () => T): T {
    try {
      this.reserve();
    } catch {
      throw new Error('HISTORY_UNAVAILABLE');
    }
    this.database.exec('BEGIN EXCLUSIVE');
    try {
      const result = work();
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      if (this.database.isTransaction) this.database.exec('ROLLBACK');
      throw error;
    }
  }
  private conversation(idValue: string): Row {
    const row = this.database.prepare('SELECT * FROM conversations WHERE id=?').get(id(idValue));
    if (!row) throw new Error('UNKNOWN_CONVERSATION');
    return row;
  }
  private attempt(idValue: string): Row {
    const row = this.database
      .prepare(
        'SELECT a.*,u.conversation_id FROM attempts a JOIN user_turns u ON u.id=a.turn_id WHERE a.id=?',
      )
      .get(id(idValue));
    if (!row) throw new Error('UNKNOWN_ATTEMPT');
    return row;
  }
  private bump(conversationId: string) {
    const revision = integer(this.conversation(conversationId), 'revision');
    if (revision === Number.MAX_SAFE_INTEGER) throw new Error('HISTORY_FULL');
    this.database
      .prepare('UPDATE conversations SET revision=revision+1,updated=? WHERE id=? AND revision=?')
      .run(Date.now(), conversationId, revision);
    const row = this.database
      .prepare(
        `SELECT length(CAST(draft AS BLOB))+length(CAST(title AS BLOB))+
      COALESCE((SELECT SUM(length(CAST(text AS BLOB))) FROM user_turns WHERE conversation_id=c.id),0)+
      COALESCE((SELECT SUM(length(CAST(a.text AS BLOB))+length(CAST(a.reasoning AS BLOB))) FROM attempts a JOIN user_turns u ON u.id=a.turn_id WHERE u.conversation_id=c.id),0) AS bytes FROM conversations c WHERE id=?`,
      )
      .get(conversationId);
    if (!row || integer(row, 'bytes') > GENERATION_LIMITS.maxConversationBytes)
      throw new Error('HISTORY_FULL');
  }
  private idle(conversationId: string) {
    if (
      this.database
        .prepare(
          "SELECT a.id FROM attempts a JOIN user_turns u ON u.id=a.turn_id WHERE u.conversation_id=? AND a.state IN ('queued','running','cancelling') LIMIT 1",
        )
        .get(conversationId)
    )
      throw new Error('CONVERSATION_BUSY');
  }
  private insertAttempt(
    attemptId: string,
    requestId: string,
    turnId: string,
    source: Provenance,
  ): Attempt {
    if (
      this.database
        .prepare('SELECT id FROM attempts WHERE id=? OR request_id=?')
        .get(attemptId, requestId)
    )
      throw new Error('INVALID_HISTORY');
    const ordinal = this.database
      .prepare('SELECT COUNT(*) AS count FROM attempts WHERE turn_id=?')
      .get(turnId)?.count;
    if (typeof ordinal !== 'number') throw new Error('INVALID_HISTORY');
    this.database
      .prepare('INSERT INTO attempts VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(
        attemptId,
        turnId,
        ordinal,
        requestId,
        'queued',
        '',
        null,
        Date.now(),
        Date.now(),
        JSON.stringify(source),
        '',
        null,
        null,
      );
    return {
      id: attemptId,
      requestId,
      turnId,
      text: '',
      reasoning: '',
      state: 'queued',
      outcome: null,
      provenance: source,
    };
  }
  newConversation(reuseEmpty = false): Promise<Conversation> {
    return this.run(() =>
      this.transaction(() => {
        if (reuseEmpty) {
          const empty = this.database
            .prepare(
              "SELECT id,updated,revision FROM conversations c WHERE title='New chat' AND draft='' AND NOT EXISTS (SELECT 1 FROM user_turns u WHERE u.conversation_id=c.id) ORDER BY updated DESC,id LIMIT 1",
            )
            .get();
          if (empty)
            return {
              id: field(empty, 'id'),
              title: 'New chat',
              draft: '',
              revision: integer(empty, 'revision'),
              updated: integer(empty, 'updated'),
              turns: [],
            };
        }
        const value = randomUUID();
        const now = Date.now();
        this.database
          .prepare('INSERT INTO conversations VALUES(?,?,?,?,?,?)')
          .run(value, 'New chat', '', now, now, 0);
        return { id: value, title: 'New chat', draft: '', revision: 0, updated: now, turns: [] };
      }),
    );
  }
  saveDraft(value: string, draft: string): Promise<void> {
    return this.run(() => {
      id(value);
      inputText(draft, true);
      return this.transaction(() => {
        this.conversation(value);
        this.database.prepare('UPDATE conversations SET draft=? WHERE id=?').run(draft, value);
        this.bump(value);
      });
    });
  }
  /** Delete an idle conversation and its children in the reserved, rollback-capable transaction. */
  deleteConversation(value: string): Promise<void> {
    return this.run(() => {
      id(value);
      this.transaction(() => {
        this.conversation(value);
        this.idle(value);
        this.database
          .prepare(
            'DELETE FROM attempts WHERE turn_id IN (SELECT id FROM user_turns WHERE conversation_id=?)',
          )
          .run(value);
        this.database.prepare('DELETE FROM user_turns WHERE conversation_id=?').run(value);
        this.database.prepare('DELETE FROM conversations WHERE id=?').run(value);
      });
      this.deletionRevision++;
    });
  }
  beginTurn(input: BeginTurn): Promise<Attempt> {
    return this.run(() => {
      if (
        Object.keys(input).sort().join(',') !==
        'attemptId,conversationId,provenance,requestId,text,turnId'
      )
        throw new Error('INVALID_HISTORY');
      for (const value of [input.conversationId, input.turnId, input.attemptId, input.requestId])
        id(value);
      inputText(input.text, false);
      const source = provenance(input.provenance);
      return this.transaction(() => {
        this.conversation(input.conversationId);
        this.idle(input.conversationId);
        if (this.database.prepare('SELECT id FROM user_turns WHERE id=?').get(input.turnId))
          throw new Error('INVALID_HISTORY');
        const ordinal = this.database
          .prepare('SELECT COUNT(*) AS count FROM user_turns WHERE conversation_id=?')
          .get(input.conversationId)?.count;
        if (typeof ordinal !== 'number') throw new Error('INVALID_HISTORY');
        this.database
          .prepare('INSERT INTO user_turns VALUES(?,?,?,?,?)')
          .run(input.turnId, input.conversationId, ordinal, input.text, Date.now());
        const result = this.insertAttempt(input.attemptId, input.requestId, input.turnId, source);
        this.database
          .prepare(
            'UPDATE conversations SET draft=?,title=CASE WHEN title=? THEN ? ELSE title END WHERE id=?',
          )
          .run('', 'New chat', input.text.slice(0, 80), input.conversationId);
        this.bump(input.conversationId);
        return result;
      });
    });
  }
  retry(
    previous: string,
    attemptId: string,
    requestId: string,
    source: Provenance,
  ): Promise<Attempt> {
    return this.run(() => {
      id(previous);
      id(attemptId);
      id(requestId);
      const exact = provenance(source);
      return this.transaction(() => {
        const row = this.attempt(previous),
          conversationId = field(row, 'conversation_id');
        if (active.includes(field(row, 'state'))) throw new Error('CONVERSATION_BUSY');
        this.idle(conversationId);
        const result = this.insertAttempt(attemptId, requestId, field(row, 'turn_id'), exact);
        this.bump(conversationId);
        return result;
      });
    });
  }
  /** Append both streams atomically; their combined bytes share the response/history quotas. */
  checkpoint(
    value: string,
    content: string,
    state: 'queued' | 'running' | 'cancelling',
    reasoning = '',
    thinkingMs?: number,
  ): Promise<void> {
    return this.update(value, content, state, null, reasoning, thinkingMs);
  }
  finish(
    value: string,
    content: string,
    result: TerminalOutcome,
    reasoning = '',
    measured?: GenerationSpeeds,
    thinkingMs?: number,
  ): Promise<void> {
    return this.run(() => {
      const terminal = outcome(result);
      return this.write(value, content, terminal.status, terminal, reasoning, measured, thinkingMs);
    });
  }
  private update(
    value: string,
    content: string,
    state: string,
    result: TerminalOutcome | null,
    reasoning: string,
    thinkingMs?: number,
  ): Promise<void> {
    return this.run(() => {
      if (!active.includes(state)) throw new Error('INVALID_HISTORY');
      return this.write(value, content, state, result, reasoning, undefined, thinkingMs);
    });
  }
  private write(
    value: string,
    content: string,
    state: string,
    result: TerminalOutcome | null,
    reasoning: string,
    measured?: GenerationSpeeds,
    thinkingMs?: number,
  ): void {
    id(value);
    text(content, GENERATION_LIMITS.maxResponseBytes);
    text(reasoning, GENERATION_LIMITS.maxResponseBytes);
    if (measured !== undefined && state !== 'completed' && state !== 'limit-reached')
      throw new Error('INVALID_HISTORY');
    const encodedSpeeds = measured === undefined ? null : JSON.stringify(speeds(measured));
    const elapsed = thinkingMs === undefined ? null : duration(thinkingMs);
    if (elapsed !== null && !reasoning) throw new Error('INVALID_HISTORY');
    if (
      Buffer.byteLength(content) + Buffer.byteLength(reasoning) >
      GENERATION_LIMITS.maxResponseBytes
    )
      throw new Error('HISTORY_FULL');
    this.transaction(() => {
      const row = this.attempt(value),
        oldState = field(row, 'state'),
        oldText = field(row, 'text'),
        oldReasoning = field(row, 'reasoning');
      if (!active.includes(oldState)) {
        if (
          state === oldState &&
          content === oldText &&
          reasoning === oldReasoning &&
          encodedSpeeds === row.speeds &&
          elapsed === row.thinking_ms &&
          result?.reason === row.reason
        )
          return;
        throw new Error('INVALID_TRANSITION');
      }
      if (
        !content.startsWith(oldText) ||
        !reasoning.startsWith(oldReasoning) ||
        (row.thinking_ms !== null && elapsed !== row.thinking_ms) ||
        (oldState === 'running' && state === 'queued') ||
        (oldState === 'cancelling' && active.includes(state) && state !== 'cancelling')
      )
        throw new Error('INVALID_TRANSITION');
      this.database
        .prepare(
          'UPDATE attempts SET text=?,reasoning=?,state=?,reason=?,updated=?,speeds=?,thinking_ms=? WHERE id=? AND state=? AND text=? AND reasoning=?',
        )
        .run(
          content,
          reasoning,
          state,
          result?.reason ?? null,
          Date.now(),
          encodedSpeeds,
          elapsed,
          value,
          oldState,
          oldText,
          oldReasoning,
        );
      this.bump(field(row, 'conversation_id'));
    });
  }
  recoverInterrupted(): Promise<void> {
    return this.run(() =>
      this.transaction(() => {
        const conversations = this.database
          .prepare(
            "SELECT DISTINCT u.conversation_id FROM user_turns u JOIN attempts a ON u.id=a.turn_id WHERE a.state IN ('queued','running','cancelling')",
          )
          .all();
        this.database
          .prepare(
            "UPDATE attempts SET state='interrupted',reason='CHANNEL_LOST',updated=? WHERE state IN ('queued','running','cancelling')",
          )
          .run(Date.now());
        for (const row of conversations) this.bump(field(row, 'conversation_id'));
      }),
    );
  }
  readConversation(value: string): Promise<Conversation> {
    return this.run(() => {
      const row = this.conversation(value);
      const turns = this.database
        .prepare('SELECT * FROM user_turns WHERE conversation_id=? ORDER BY ordinal')
        .all(value)
        .map((turn) => ({
          id: field(turn, 'id'),
          text: field(turn, 'text'),
          attempts: this.database
            .prepare('SELECT * FROM attempts WHERE turn_id=? ORDER BY ordinal')
            .all(field(turn, 'id'))
            .map((attempt) => {
              const parsed: unknown = JSON.parse(field(attempt, 'provenance'));
              if (
                !parsed ||
                typeof parsed !== 'object' ||
                !('configuration' in parsed) ||
                !('packageId' in parsed) ||
                !('upstreamCommit' in parsed)
              )
                throw new Error('UNSUPPORTED_HISTORY');
              // Persisted provenance is validated through the same closed trusted-data schema.
              const source = provenance(parsed as Provenance),
                state = field(attempt, 'state');
              return {
                id: field(attempt, 'id'),
                requestId: field(attempt, 'request_id'),
                turnId: field(attempt, 'turn_id'),
                text: field(attempt, 'text'),
                reasoning: field(attempt, 'reasoning'),
                ...(attempt.thinking_ms === null
                  ? {}
                  : { thinkingMs: duration(attempt.thinking_ms) }),
                ...(attempt.speeds === null
                  ? {}
                  : { speeds: speeds(JSON.parse(field(attempt, 'speeds')) as unknown) }),
                state,
                outcome: active.includes(state)
                  ? null
                  : outcome({ status: state, reason: attempt.reason }),
                provenance: source,
              };
            }),
        }));
      return {
        id: field(row, 'id'),
        title: field(row, 'title'),
        draft: field(row, 'draft'),
        revision: integer(row, 'revision'),
        updated: integer(row, 'updated'),
        turns,
      };
    });
  }
  /** Core-only retry resolution; never scan or return unrelated conversation bodies. */
  retrySource(value: string): Promise<{ conversationId: string; turnId: string; text: string }> {
    return this.run(() => {
      const attempt = this.attempt(value);
      const turn = this.database
        .prepare('SELECT text FROM user_turns WHERE id=?')
        .get(field(attempt, 'turn_id'));
      if (!turn) throw new Error('UNKNOWN_ATTEMPT');
      return {
        conversationId: field(attempt, 'conversation_id'),
        turnId: field(attempt, 'turn_id'),
        text: field(turn, 'text'),
      };
    });
  }
  /** Bounded summaries; message bodies are fetched separately. */
  listConversations(offset = 0, query?: string): Promise<readonly Conversation[]> {
    return this.run(() =>
      this.database
        .prepare(
          `SELECT id,title,draft,revision,updated FROM conversations c
          ${
            query === undefined
              ? ''
              : `WHERE chat_contains(c.title,?) OR
            EXISTS (SELECT 1 FROM user_turns u WHERE u.conversation_id=c.id AND chat_contains(u.text,?)) OR
            EXISTS (SELECT 1 FROM attempts a JOIN user_turns u ON u.id=a.turn_id WHERE u.conversation_id=c.id AND chat_contains(a.text,?))`
          }
          ORDER BY updated DESC,id LIMIT 32 OFFSET ?`,
        )
        .all(
          ...(query === undefined ? [offset] : [query.trim(), query.trim(), query.trim(), offset]),
        )
        .map((row) => ({
          id: field(row, 'id'),
          title: field(row, 'title'),
          draft: field(row, 'draft'),
          revision: integer(row, 'revision'),
          updated: integer(row, 'updated'),
          turns: [],
        })),
    );
  }
  /** Writer-local deletion epoch prevents cursor reuse when counts/revisions are replaced. */
  listRevision(): Promise<string> {
    return this.run(() => {
      const row = this.database
        .prepare('SELECT COUNT(*) AS count,COALESCE(SUM(revision),0) AS version FROM conversations')
        .get();
      if (!row) throw new Error('HISTORY_UNAVAILABLE');
      return `${this.deletionRevision}:${integer(row, 'count')}:${integer(row, 'version')}`;
    });
  }
  close(): void {
    if (!this.closed) {
      this.database.close();
      this.closed = true;
    }
  }
}

/** Native errors can contain private paths; only closed categories cross this boundary. */
function storageFailure(code: 'HISTORY_FULL' | 'HISTORY_UNAVAILABLE'): never {
  throw new Error(code);
}

/** Only production-facing storage opener: guard acquisition precedes SQLite; no arbitrary-path API. */
export async function openHistoryStore(
  root: TrustedHistoryRoot,
): Promise<{ readonly store: HistoryStore; close(): void }> {
  const guard = openHistoryDirectory(root);
  let database: DatabaseSync | undefined;
  try {
    // Inspect the retained file before SQLite can create WAL sidecars or perform recovery writes.
    const file = openSync(guard.database, 'r');
    try {
      if (fstatSync(file).size > 0) {
        const header = Buffer.alloc(100),
          count = readSync(file, header, 0, 100, 0);
        if (
          count !== 100 ||
          header.subarray(0, 16).toString('ascii') !== 'SQLite format 3\0' ||
          header[18] !== 1 ||
          header[19] !== 1
        )
          throw new Error('UNSUPPORTED_HISTORY');
      }
    } finally {
      closeSync(file);
    }
    // A read-only preflight cannot repair an unknown/corrupt file through a hot journal.
    const preview = new DatabaseSync(guard.database, { readOnly: true, allowExtension: false });
    try {
      preview.exec('PRAGMA trusted_schema=OFF; PRAGMA temp_store=MEMORY; PRAGMA foreign_keys=ON;');
      if (fstatSize(guard.database) > 0) inspectSchema(preview);
    } finally {
      preview.close();
    }
    database = new DatabaseSync(guard.database, { allowExtension: false });
    const store = new HistoryStore(database, () => guard.reserveJournal());
    await store.recoverInterrupted();
    return {
      store,
      close() {
        store.close();
        guard.close();
      },
    };
  } catch {
    if (database?.isOpen) database.close();
    guard.close();
    throw new Error('HISTORY_UNAVAILABLE');
  }
}
function fstatSize(fileName: string): number {
  const file = openSync(fileName, 'r');
  try {
    return fstatSync(file).size;
  } finally {
    closeSync(file);
  }
}
