import { DatabaseSync } from 'node:sqlite';
import { openConfigurationDirectory } from '../history/windows-directory.js';
import type { TrustedHistoryRoot } from '../history/windows-directory.js';
import { createModelConfiguration, decodeModelConfiguration } from './contracts.js';
import type {
  LoadDefaults,
  ModelConfigurationRecord,
  RuntimeSettingCapabilities,
} from './contracts.js';

const tables = {
  configuration_schema:
    'CREATE TABLE configuration_schema(version INTEGER NOT NULL CHECK(version=1))',
  model_configurations:
    'CREATE TABLE model_configurations(model_id TEXT PRIMARY KEY NOT NULL,revision INTEGER NOT NULL CHECK(revision>0),record TEXT NOT NULL)',
  api_credential:
    'CREATE TABLE api_credential(id INTEGER PRIMARY KEY CHECK(id=1),generation INTEGER NOT NULL CHECK(generation>0),protected BLOB NOT NULL)',
  model_imports:
    'CREATE TABLE model_imports(model_id TEXT PRIMARY KEY NOT NULL,created INTEGER NOT NULL CHECK(created>0))',
};
const safeErrors = new Set([
  'UNKNOWN_MODEL',
  'INVALID_CONFIGURATION',
  'STALE_CONFIGURATION',
  'UNSUPPORTED_CONFIGURATION',
  'UNSUPPORTED_SETTING',
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
    );
    if (database.prepare('PRAGMA journal_mode').get()?.journal_mode !== 'persist')
      return configurationUnavailable();
    const opened = database;
    let closed = false;
    return {
      store,
      close() {
        if (!closed) {
          closed = true;
          try {
            opened.close();
          } finally {
            guard.close();
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
  constructor(
    private readonly database: DatabaseSync,
    private readonly reserve: () => void,
    private readonly knownModel: (modelId: string) => boolean,
    private readonly capabilities: RuntimeSettingCapabilities,
    private readonly initialLoad: LoadDefaults,
  ) {
    this.safe(() => {
      const schema = database
        .prepare("SELECT name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'")
        .all();
      if (schema.length) {
        if (
          schema.length !== 4 ||
          schema.some(
            (row) =>
              typeof row.name !== 'string' ||
              !Object.hasOwn(tables, row.name) ||
              Reflect.get(tables, row.name) !== row.sql,
          )
        )
          throw new Error('UNSUPPORTED_CONFIGURATION');
        const versions = database.prepare('SELECT version FROM configuration_schema').all();
        if (
          versions.length !== 1 ||
          versions[0]?.version !== 1 ||
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
          database.exec('INSERT INTO configuration_schema VALUES(1)');
        }
      });
    });
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
  recordImport(modelId: string, created: number): Promise<number> {
    return Promise.resolve().then(() =>
      this.safe(() => {
        this.checkModel(modelId);
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
          return stored;
        });
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
    if (!row) return createModelConfiguration(modelId, this.initialLoad, this.capabilities);
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
