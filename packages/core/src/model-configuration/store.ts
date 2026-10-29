import { DatabaseSync } from 'node:sqlite';
import { ClusterStore } from '../cluster/store.js';
import { openConfigurationDirectory } from '../history/windows-directory.js';
import type { TrustedHistoryRoot } from '../history/windows-directory.js';
import { createModelConfiguration, decodeModelConfiguration } from './contracts.js';
import { decodeModelSource } from './model-source.js';
import type { ModelSource } from './model-source.js';
import type { CapturedClusterLoad } from '../cluster/contracts.js';
import type {
  LoadDefaults,
  ModelConfigurationRecord,
  RuntimeSettingCapabilities,
} from './contracts.js';

const oldTables = {
  configuration_schema:
    'CREATE TABLE configuration_schema(version INTEGER NOT NULL CHECK(version=1))',
  model_configurations:
    'CREATE TABLE model_configurations(model_id TEXT PRIMARY KEY NOT NULL,revision INTEGER NOT NULL CHECK(revision>0),record TEXT NOT NULL)',
  api_credential:
    'CREATE TABLE api_credential(id INTEGER PRIMARY KEY CHECK(id=1),generation INTEGER NOT NULL CHECK(generation>0),protected BLOB NOT NULL)',
  model_imports:
    'CREATE TABLE model_imports(model_id TEXT PRIMARY KEY NOT NULL,created INTEGER NOT NULL CHECK(created>0))',
};
const indexTables = {
  ...oldTables,
  configuration_schema:
    'CREATE TABLE configuration_schema(version INTEGER NOT NULL CHECK(version=2))',
  model_sources:
    'CREATE TABLE model_sources(model_id TEXT PRIMARY KEY NOT NULL,record TEXT NOT NULL)',
};
const usageTables = {
  ...indexTables,
  configuration_schema:
    'CREATE TABLE configuration_schema(version INTEGER NOT NULL CHECK(version=3))',
  model_usage:
    'CREATE TABLE model_usage(model_id TEXT PRIMARY KEY NOT NULL,last_used INTEGER NOT NULL CHECK(last_used>0))',
};
const tables = {
  ...usageTables,
  configuration_schema:
    'CREATE TABLE configuration_schema(version INTEGER NOT NULL CHECK(version=4))',
  cluster_drafts:
    'CREATE TABLE cluster_drafts(draft_key TEXT PRIMARY KEY NOT NULL,revision INTEGER NOT NULL CHECK(revision>0),record TEXT NOT NULL)',
  cluster_configurations:
    'CREATE TABLE cluster_configurations(configuration_id TEXT PRIMARY KEY NOT NULL,revision INTEGER NOT NULL CHECK(revision>0),record TEXT NOT NULL)',
};
const safeErrors = new Set([
  'UNKNOWN_MODEL',
  'INVALID_CONFIGURATION',
  'STALE_CONFIGURATION',
  'UNSUPPORTED_CONFIGURATION',
  'UNSUPPORTED_SETTING',
  'INVALID_CLUSTER_CONFIGURATION',
  'UNKNOWN_CONFIGURATION',
  'NEEDS_MODEL_METADATA',
  'UNREPRESENTABLE_CLUSTER_PLACEMENT',
]);
export interface ProtectedApiCredential {
  readonly generation: number;
  readonly protectedKey: Buffer;
}

/** Open the separate retained configuration database. Close SQLite before releasing identities. */
export function openModelConfigurationStore(
  root: TrustedHistoryRoot,
  knownModel: (modelId: string) => boolean,
  capabilities: RuntimeSettingCapabilities,
  initialLoad: LoadDefaults,
  clusterCaches: Pick<CapturedClusterLoad, 'cacheK' | 'cacheV'> = {
    cacheK: 'q8_0',
    cacheV: 'q8_0',
  },
): { store: ModelConfigurationStore; close(): void } {
  const guard = openConfigurationDirectory(root);
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(guard.database, { allowExtension: false });
    const store = new ModelConfigurationStore(
      database,
      () => guard.reserveJournal(),
      knownModel,
      capabilities,
      initialLoad,
      clusterCaches,
    );
    if (database.prepare('PRAGMA journal_mode').get()?.journal_mode !== 'persist')
      return configurationUnavailable();
    store.cluster.clearSessionDrafts();
    const opened = database;
    let closed = false;
    return {
      store,
      close() {
        if (!closed) {
          closed = true;
          try {
            store.cluster.clearSessionDrafts();
          } finally {
            try {
              opened.close();
            } finally {
              guard.close();
            }
          }
        }
      },
    };
  } catch {
    try {
      database?.close();
    } finally {
      guard.close();
    }
    throw new Error('CONFIGURATION_UNAVAILABLE');
  }
}

function configurationUnavailable(): never {
  throw new Error('CONFIGURATION_UNAVAILABLE');
}

/** Utility-owned single writer. The trusted directory guard must outlive this store/database.
 * No renderer can supply SQL, storage paths, model-registration authority or capabilities.
 */
export class ModelConfigurationStore {
  readonly cluster: ClusterStore;
  constructor(
    private readonly database: DatabaseSync,
    private readonly reserve: () => void,
    private readonly knownModel: (modelId: string) => boolean,
    private readonly capabilities: RuntimeSettingCapabilities,
    private readonly initialLoad: LoadDefaults,
    clusterCaches: Pick<CapturedClusterLoad, 'cacheK' | 'cacheV'> = {
      cacheK: 'q8_0',
      cacheV: 'q8_0',
    },
  ) {
    this.safe(() => {
      const schema = database
        .prepare("SELECT name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'")
        .all();
      if (schema.length) {
        const expected =
          schema.length === 4
            ? oldTables
            : schema.length === 5
              ? indexTables
              : schema.length === 6
                ? usageTables
                : tables;
        if (
          schema.length !== Object.keys(expected).length ||
          schema.some(
            (row) =>
              typeof row.name !== 'string' ||
              !Object.hasOwn(expected, row.name) ||
              Reflect.get(expected, row.name) !== row.sql,
          )
        )
          throw new Error('UNSUPPORTED_CONFIGURATION');
        const versions = database.prepare('SELECT version FROM configuration_schema').all();
        if (
          versions.length !== 1 ||
          versions[0]?.version !==
            (schema.length === 4 ? 1 : schema.length === 5 ? 2 : schema.length === 6 ? 3 : 4) ||
          database
            .prepare('PRAGMA integrity_check')
            .all()
            .some((row) => row.integrity_check !== 'ok')
        )
          throw new Error('UNSUPPORTED_CONFIGURATION');
      }
      if (database.prepare('PRAGMA page_size').get()?.page_size !== 4096)
        throw new Error('UNSUPPORTED_CONFIGURATION');
      database.exec(
        'PRAGMA trusted_schema=OFF; PRAGMA journal_mode=PERSIST; PRAGMA locking_mode=EXCLUSIVE; PRAGMA synchronous=FULL; PRAGMA max_page_count=1024; PRAGMA journal_size_limit=8388608',
      );
      this.transaction(() => {
        if (!schema.length) {
          for (const sql of Object.values(tables)) database.exec(sql);
          database.exec('INSERT INTO configuration_schema VALUES(4)');
        } else if (schema.length < 8) {
          database.exec('DROP TABLE configuration_schema');
          database.exec(tables.configuration_schema);
          database.exec('INSERT INTO configuration_schema VALUES(4)');
          if (schema.length === 4) database.exec(tables.model_sources);
          if (schema.length < 6) database.exec(tables.model_usage);
          database.exec(tables.cluster_drafts);
          database.exec(tables.cluster_configurations);
        }
      });
    });
    this.cluster = new ClusterStore(
      database,
      (work) => this.safe(work),
      (work) => this.safe(() => this.transaction(work)),
      (id) => this.checkModel(id),
      capabilities.profileId,
      (modelId) => {
        const record = this.readNow(modelId);
        return {
          defaults: record.load,
          preferences: record.preferences,
          ...(record.speculation ? { speculation: record.speculation } : {}),
          cacheK: clusterCaches.cacheK,
          cacheV: record.load.flashAttention ? clusterCaches.cacheV : 'f16',
        };
      },
    );
    this.cluster.removeEmbeddedSettings();
  }

  /** Read only an imported identity. An unsaved model starts with the actual trusted profile. */
  read(modelId: string): Promise<ModelConfigurationRecord> {
    return Promise.resolve().then(() => this.safe(() => this.readNow(modelId)));
  }
  readImport(modelId: string): Promise<number | null> {
    return Promise.resolve().then(() =>
      this.safe(() => {
        this.checkModel(modelId);
        return this.readImportNow(modelId);
      }),
    );
  }
  /** Trusted dispatch time only. Concurrent completion cannot move usage backwards. */
  recordUse(modelId: string, usedAt: number): Promise<void> {
    return Promise.resolve().then(() =>
      this.safe(() => {
        this.checkModel(modelId);
        if (!Number.isSafeInteger(usedAt) || usedAt < 1 || usedAt > Date.now() + 30000)
          throw new Error('INVALID_CONFIGURATION');
        this.transaction(() => {
          this.database
            .prepare(
              'INSERT INTO model_usage VALUES(?,?) ON CONFLICT(model_id) DO UPDATE SET last_used=MAX(model_usage.last_used,excluded.last_used)',
            )
            .run(modelId, usedAt);
        });
      }),
    );
  }
  /** Retained independently of imports, loading and chat-history deletion. */
  readUse(modelId: string): Promise<number | null> {
    return Promise.resolve().then(() =>
      this.safe(() => {
        this.checkModel(modelId);
        const row = this.database
          .prepare('SELECT last_used FROM model_usage WHERE model_id=?')
          .get(modelId);
        if (!row) return null;
        if (
          typeof row.last_used !== 'number' ||
          !Number.isSafeInteger(row.last_used) ||
          row.last_used < 1
        )
          throw new Error('UNSUPPORTED_CONFIGURATION');
        return row.last_used;
      }),
    );
  }
  private readImportNow(modelId: string): number | null {
    const row = this.database
      .prepare('SELECT created FROM model_imports WHERE model_id=?')
      .get(modelId);
    if (!row) return null;
    if (typeof row.created !== 'number' || !Number.isSafeInteger(row.created) || row.created < 1)
      throw new Error('UNSUPPORTED_CONFIGURATION');
    return row.created;
  }
  /** Main supplies the actual verified import time, retained across same-content reimports. */
  recordImport(modelId: string, created: number, source?: ModelSource): Promise<number> {
    return Promise.resolve().then(() =>
      this.safe(() => {
        this.checkModel(modelId);
        const decoded = source === undefined ? undefined : decodeModelSource(source);
        if (decoded && decoded.modelId !== modelId) throw new Error('INVALID_CONFIGURATION');
        if (
          !Number.isSafeInteger(created) ||
          created < 1 ||
          created > Math.floor(Date.now() / 1000) + 30
        )
          throw new Error('INVALID_CONFIGURATION');
        return this.transaction(() => {
          this.database
            .prepare('INSERT INTO model_imports VALUES(?,?) ON CONFLICT(model_id) DO NOTHING')
            .run(modelId, created);
          const stored = this.readImportNow(modelId);
          if (stored === null) throw new Error('UNSUPPORTED_CONFIGURATION');
          if (decoded)
            this.database
              .prepare('INSERT OR REPLACE INTO model_sources VALUES(?,?)')
              .run(modelId, JSON.stringify(decoded));
          return stored;
        });
      }),
    );
  }

  /** Main-only header reconciliation updates metadata without changing registration order or identity. */
  reinspectImport(input: ModelSource): Promise<void> {
    return Promise.resolve().then(() =>
      this.safe(() => {
        const source = decodeModelSource(input);
        if (source.classificationVersion !== 1) throw Error('INVALID_CONFIGURATION');
        const row = this.database
          .prepare('SELECT record FROM model_sources WHERE model_id=?')
          .get(source.modelId);
        if (
          !row ||
          typeof row.record !== 'string' ||
          Buffer.byteLength(row.record) > 131072 ||
          this.readImportNow(source.modelId) === null
        )
          throw Error('INVALID_CONFIGURATION');
        const previous = decodeModelSource(JSON.parse(row.record));
        if (
          previous.modelId !== source.modelId ||
          previous.file !== source.file ||
          previous.sizeBytes !== source.sizeBytes ||
          previous.modifiedMs !== source.modifiedMs
        )
          throw Error('INVALID_CONFIGURATION');
        this.transaction(() => {
          this.database
            .prepare('UPDATE model_sources SET record=? WHERE model_id=?')
            .run(JSON.stringify(source), source.modelId);
        });
      }),
    );
  }

  /** Forget the library index only; retain model defaults, history and the user's GGUF. */
  removeImport(modelId: string): Promise<void> {
    return Promise.resolve().then(() =>
      this.safe(() => {
        if (!/^[a-f0-9]{64}$/u.test(modelId)) throw Error('INVALID_CONFIGURATION');
        return this.transaction(() => {
          this.database.prepare('DELETE FROM model_sources WHERE model_id=?').run(modelId);
          this.database.prepare('DELETE FROM model_imports WHERE model_id=?').run(modelId);
        });
      }),
    );
  }

  /** Restore the indexed source without opening or loading the referenced model. */
  readLibraryEntry(
    after: string | null,
  ): Promise<{ source: ModelSource; lastUsedAt: number | null } | null> {
    return Promise.resolve().then(() =>
      this.safe(() => {
        if (after !== null && !/^[a-f0-9]{64}$/u.test(after)) throw Error('INVALID_CONFIGURATION');
        const row = this.database
          .prepare(
            'SELECT s.model_id,s.record,u.last_used FROM model_sources s JOIN model_imports i ON i.model_id=s.model_id LEFT JOIN model_usage u ON u.model_id=s.model_id WHERE (? IS NULL OR s.model_id>?) ORDER BY s.model_id LIMIT 1',
          )
          .get(after, after);
        if (!row) return null;
        if (typeof row.record !== 'string' || Buffer.byteLength(row.record) > 131072)
          throw Error('UNSUPPORTED_CONFIGURATION');
        const source = decodeModelSource(JSON.parse(row.record));
        if (
          source.modelId !== row.model_id ||
          (row.last_used !== null &&
            (typeof row.last_used !== 'number' ||
              !Number.isSafeInteger(row.last_used) ||
              row.last_used < 1))
        )
          throw Error('UNSUPPORTED_CONFIGURATION');
        return { source, lastUsedAt: row.last_used };
      }),
    );
  }

  /** Restore the latest full target; companion imports never select a target. */
  readLatestImportSource(): Promise<ModelSource | null> {
    return Promise.resolve().then(() =>
      this.safe(() => {
        const rows = this.database
          .prepare(
            'SELECT s.record FROM model_sources s JOIN model_imports i ON i.model_id=s.model_id ORDER BY s.rowid DESC',
          )
          .iterate();
        for (const row of rows) {
          if (typeof row.record !== 'string' || Buffer.byteLength(row.record) > 131072)
            throw Error('UNSUPPORTED_CONFIGURATION');
          const source = decodeModelSource(JSON.parse(row.record));
          if (!source.speculativeHead) return source;
        }
        return null;
      }),
    );
  }
  readImportSource(modelId: string): Promise<ModelSource | null> {
    return Promise.resolve().then(() =>
      this.safe(() => {
        this.checkModel(modelId);
        const row = this.database
          .prepare('SELECT record FROM model_sources WHERE model_id=?')
          .get(modelId);
        if (!row) return null;
        if (typeof row.record !== 'string' || Buffer.byteLength(row.record) > 131072)
          throw new Error('UNSUPPORTED_CONFIGURATION');
        const source = decodeModelSource(JSON.parse(row.record));
        if (source.modelId !== modelId || this.readImportNow(modelId) === null)
          throw new Error('UNSUPPORTED_CONFIGURATION');
        return source;
      }),
    );
  }

  /** Protected bytes only. Recovering the public API key belongs to the credential owner. */
  readCredential(): Promise<ProtectedApiCredential | null> {
    return Promise.resolve().then(() => this.safe(() => this.readCredentialNow()));
  }
  private readCredentialNow(): ProtectedApiCredential | null {
    const rows = this.database.prepare('SELECT generation,protected FROM api_credential').all();
    if (!rows.length) return null;
    const row = rows[0];
    if (
      rows.length !== 1 ||
      !row ||
      typeof row.generation !== 'number' ||
      !Number.isSafeInteger(row.generation) ||
      row.generation < 1 ||
      !(row.protected instanceof Uint8Array) ||
      !row.protected.length ||
      row.protected.length > 4096
    )
      throw new Error('UNSUPPORTED_CONFIGURATION');
    return Object.freeze({ generation: row.generation, protectedKey: Buffer.from(row.protected) });
  }
  /** Atomic rotation with CAS. No plaintext key parameter or renderer management route exists. */
  replaceCredential(expectedGeneration: number, input: Buffer): Promise<ProtectedApiCredential> {
    if (
      !Buffer.isBuffer(input) ||
      !input.length ||
      input.length > 4096 ||
      !Number.isSafeInteger(expectedGeneration) ||
      expectedGeneration < 0 ||
      expectedGeneration >= Number.MAX_SAFE_INTEGER
    )
      return Promise.reject(new Error('INVALID_CONFIGURATION'));
    const protectedKey = Buffer.from(input);
    return Promise.resolve().then(() =>
      this.safe(() =>
        this.transaction(() => {
          if ((this.readCredentialNow()?.generation ?? 0) !== expectedGeneration)
            throw new Error('STALE_CONFIGURATION');
          const generation = expectedGeneration + 1;
          this.database
            .prepare(
              'INSERT INTO api_credential VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET generation=excluded.generation,protected=excluded.protected',
            )
            .run(generation, protectedKey);
          return Object.freeze({ generation, protectedKey: Buffer.from(protectedKey) });
        }),
      ),
    );
  }

  /** Compare-and-swap a complete record. Failure leaves the prior transaction committed. */
  save(
    modelId: string,
    expectedRevision: number,
    proposed: ModelConfigurationRecord,
  ): Promise<ModelConfigurationRecord> {
    return Promise.resolve().then(() =>
      this.safe(() => {
        this.checkModel(modelId);
        const decoded = decodeModelConfiguration(proposed, this.capabilities);
        if (
          decoded.generation.responseLength.enabled &&
          decoded.generation.responseLength.value > this.capabilities.maxOutputTokens
        )
          throw new Error('INVALID_CONFIGURATION');
        if (decoded.generation.thinking !== null && !this.capabilities.thinking)
          throw new Error('UNSUPPORTED_SETTING');
        if (
          !Number.isSafeInteger(expectedRevision) ||
          expectedRevision < 0 ||
          expectedRevision >= Number.MAX_SAFE_INTEGER ||
          decoded.modelId !== modelId ||
          decoded.revision !== expectedRevision
        )
          throw new Error('INVALID_CONFIGURATION');
        return this.transaction(() => {
          if (this.readNow(modelId).revision !== expectedRevision)
            throw new Error('STALE_CONFIGURATION');
          const committed = decodeModelConfiguration(
            { ...decoded, revision: expectedRevision + 1 },
            this.capabilities,
          );
          this.database
            .prepare(
              'INSERT INTO model_configurations VALUES(?,?,?) ON CONFLICT(model_id) DO UPDATE SET revision=excluded.revision,record=excluded.record',
            )
            .run(modelId, committed.revision, JSON.stringify(committed));
          return committed;
        });
      }),
    );
  }

  private checkModel(modelId: string): void {
    if (
      typeof modelId !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(modelId) ||
      !this.knownModel(modelId)
    )
      throw new Error('UNKNOWN_MODEL');
  }
  private readNow(modelId: string): ModelConfigurationRecord {
    this.checkModel(modelId);
    const row = this.database
      .prepare('SELECT revision,record FROM model_configurations WHERE model_id=?')
      .get(modelId);
    if (!row) {
      const sourceRow = this.database
        .prepare('SELECT record FROM model_sources WHERE model_id=?')
        .get(modelId);
      const source =
        sourceRow && typeof sourceRow.record === 'string'
          ? decodeModelSource(JSON.parse(sourceRow.record))
          : null;
      return createModelConfiguration(
        modelId,
        {
          ...this.initialLoad,
          contextLength: Math.min(
            this.initialLoad.contextLength,
            source?.contextLimit || this.initialLoad.contextLength,
          ),
        },
        this.capabilities,
      );
    }
    if (typeof row.record !== 'string' || Buffer.byteLength(row.record) > 65536)
      throw new Error('UNSUPPORTED_CONFIGURATION');
    const record = decodeModelConfiguration(JSON.parse(row.record), this.capabilities);
    if (record.modelId !== modelId || record.revision !== row.revision)
      throw new Error('UNSUPPORTED_CONFIGURATION');
    return record;
  }
  private transaction<T>(work: () => T): T {
    this.reserve();
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
  private safe<T>(work: () => T): T {
    try {
      return work();
    } catch (error) {
      if (error instanceof Error && safeErrors.has(error.message)) throw error;
      return configurationUnavailable();
    }
  }
}
