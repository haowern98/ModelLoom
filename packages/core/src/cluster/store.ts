import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  decodeClusterDraft,
  decodeClusterEdit,
  decodeConfigurationName,
  decodeSavedClusterConfiguration,
} from './contracts.js';
import type {
  AssignmentIssue,
  ClusterDraft,
  ClusterEdit,
  SavedClusterConfiguration,
  CapturedClusterLoad,
} from './contracts.js';
import { validateAssignment, compilePlacement } from './placement.js';
import { decodeModelSource } from '../model-configuration/model-source.js';

export type ClusterSaveResult =
  | { readonly ok: false; readonly issues: readonly AssignmentIssue[] }
  | {
      readonly ok: true;
      readonly configuration: SavedClusterConfiguration;
      readonly draft: ClusterDraft;
    };
/** Uses the configuration owner's guarded database and transaction boundary; never another writer. */
export class ClusterStore {
  constructor(
    private readonly db: DatabaseSync,
    private readonly readSafe: <T>(work: () => T) => T,
    private readonly writeSafe: <T>(work: () => T) => T,
    private readonly known: (id: string) => void,
    private readonly profileId: string,
    private readonly currentLoad: (modelId: string) => CapturedClusterLoad,
  ) {}
  /** Existing cluster records retain placement and revisions, but no embedded model preferences. */
  removeEmbeddedSettings(): void {
    const pending = this.readSafe(() => {
      const saved = this.db
        .prepare('SELECT configuration_id,revision,record FROM cluster_configurations')
        .all();
      const drafts = this.db.prepare('SELECT draft_key,revision,record FROM cluster_drafts').all();
      return {
        saved: saved.filter((row) => Object.hasOwn(this.json(row.record) as object, 'load')),
        drafts: drafts.filter((row) => Object.hasOwn(this.json(row.record) as object, 'load')),
      };
    });
    if (!pending.saved.length && !pending.drafts.length) return;
    this.writeSafe(() => {
      for (const row of pending.saved) {
        const saved = this.savedRow(row);
        this.db
          .prepare('UPDATE cluster_configurations SET record=? WHERE configuration_id=?')
          .run(this.placementRecord(saved), saved.id);
      }
      for (const row of pending.drafts) {
        if (typeof row.draft_key !== 'string') throw Error('UNSUPPORTED_CONFIGURATION');
        const draft = this.readDraft(row.draft_key);
        if (!draft) throw Error('UNSUPPORTED_CONFIGURATION');
        this.putDraft(draft);
      }
    });
  }
  private placementRecord(input: ClusterDraft | SavedClusterConfiguration): string {
    const { load, ...placement } = input;
    void load;
    return JSON.stringify(placement);
  }
  private hydrated(input: unknown, draft: boolean): unknown {
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw Error('UNSUPPORTED_CONFIGURATION');
    if (Object.hasOwn(input, 'load')) {
      if (draft) decodeClusterDraft(input);
      else decodeSavedClusterConfiguration(input);
    }
    const modelId: unknown = Reflect.get(input, 'modelId');
    if (typeof modelId !== 'string') throw Error('UNSUPPORTED_CONFIGURATION');
    this.known(modelId);
    return { ...input, load: this.currentLoad(modelId) };
  }
  list(): readonly SavedClusterConfiguration[] {
    return this.readSafe(() =>
      this.db
        .prepare(
          'SELECT configuration_id,revision,record FROM cluster_configurations ORDER BY configuration_id',
        )
        .all()
        .map((r) => this.savedRow(r)),
    );
  }
  read(id: string): SavedClusterConfiguration | null {
    return this.readSafe(() => {
      this.configId(id);
      const r = this.db
        .prepare(
          'SELECT configuration_id,revision,record FROM cluster_configurations WHERE configuration_id=?',
        )
        .get(id);
      return r ? this.savedRow(r) : null;
    });
  }
  readDraft(key: string): ClusterDraft | null {
    return this.readSafe(() => {
      this.key(key);
      const r = this.db
        .prepare('SELECT revision,record FROM cluster_drafts WHERE draft_key=?')
        .get(key);
      if (!r) return null;
      const draft = decodeClusterDraft(this.hydrated(this.json(r.record), true));
      if (draft.key !== key || draft.revision !== r.revision)
        throw Error('UNSUPPORTED_CONFIGURATION');
      this.bind(key, draft.modelId, draft.configurationId);
      return draft;
    });
  }
  writeDraft(key: string, expectedRevision: number | null, input: ClusterEdit): ClusterDraft {
    return this.writeSafe(() => {
      const edit = decodeClusterEdit(input);
      const load = this.currentLoad(edit.modelId);
      this.known(edit.modelId);
      this.key(key);
      const current = this.readDraft(key);
      this.revision(expectedRevision, current?.revision ?? null);
      const config = key.startsWith('config:') ? this.read(key.slice(7)) : null;
      if (key.startsWith('config:') && (!config || config.modelId !== edit.modelId))
        throw Error('UNKNOWN_CONFIGURATION');
      this.bind(key, edit.modelId, config?.id ?? null);
      const draft = decodeClusterDraft({
        ...edit,
        load,
        key,
        configurationId: config?.id ?? null,
        revision: (current?.revision ?? 0) + 1,
        baseSavedRevision: current?.baseSavedRevision ?? config?.revision ?? null,
      });
      this.putDraft(draft);
      return draft;
    });
  }
  saveDraft(key: string, revision: number, name?: string): ClusterSaveResult {
    return this.writeSafe(() => {
      const draft = this.readDraft(key);
      if (!draft) throw Error('UNKNOWN_CONFIGURATION');
      this.revision(revision, draft.revision);
      this.known(draft.modelId);
      const row = this.db
        .prepare('SELECT record FROM model_sources WHERE model_id=?')
        .get(draft.modelId);
      const source = row ? decodeModelSource(this.json(row.record)) : null;
      if (!source || source.modelId !== draft.modelId || !source.blockCount)
        throw Error('NEEDS_MODEL_METADATA');
      const valid = validateAssignment(draft, source.blockCount);
      if (!valid.ok) return valid;
      compilePlacement(valid.runs, source.blockCount);
      if (draft.load.defaults.contextLength > source.contextLimit)
        return { ok: false, issues: [{ uuid: null, field: 'load', code: 'invalid-load' }] };
      const previous = draft.configurationId ? this.read(draft.configurationId) : null;
      if (
        !previous &&
        Number(
          this.db.prepare('SELECT COUNT(*) AS count FROM cluster_configurations').get()?.count,
        ) >= 128
      )
        throw Error('CONFIGURATION_UNAVAILABLE');
      this.revision(draft.baseSavedRevision, previous?.revision ?? null);
      const configuration = decodeSavedClusterConfiguration({
        id: previous?.id ?? randomUUID(),
        name: name === undefined ? previous?.name : decodeConfigurationName(name),
        revision: (previous?.revision ?? 0) + 1,
        modelId: draft.modelId,
        blockCount: source.blockCount,
        profileId: this.profileId,
        load: draft.load,
        runs: valid.runs,
      });
      this.db
        .prepare(
          'INSERT INTO cluster_configurations VALUES(?,?,?) ON CONFLICT(configuration_id) DO UPDATE SET revision=excluded.revision,record=excluded.record',
        )
        .run(configuration.id, configuration.revision, this.placementRecord(configuration));
      const next = decodeClusterDraft({
        ...draft,
        key: `config:${configuration.id}`,
        configurationId: configuration.id,
        revision: draft.revision + 1,
        baseSavedRevision: configuration.revision,
      });
      this.db.prepare('DELETE FROM cluster_drafts WHERE draft_key=?').run(key);
      this.putDraft(next);
      return { ok: true, configuration, draft: next };
    });
  }
  discardDraft(key: string, revision: number): ClusterDraft | null {
    return this.writeSafe(() => {
      const draft = this.readDraft(key);
      if (!draft) throw Error('UNKNOWN_CONFIGURATION');
      this.revision(revision, draft.revision);
      if (!draft.configurationId) {
        this.db.prepare('DELETE FROM cluster_drafts WHERE draft_key=?').run(key);
        return null;
      }
      const saved = this.read(draft.configurationId);
      if (!saved) throw Error('UNKNOWN_CONFIGURATION');
      const next = decodeClusterDraft({
        ...draft,
        modelId: saved.modelId,
        load: saved.load,
        runs: saved.runs.map((r) => ({
          uuid: r.uuid,
          first: String(r.first),
          last: String(r.last),
        })),
        revision: draft.revision + 1,
        baseSavedRevision: saved.revision,
      });
      this.putDraft(next);
      return next;
    });
  }
  private putDraft(draft: ClusterDraft): void {
    this.db
      .prepare(
        'INSERT INTO cluster_drafts VALUES(?,?,?) ON CONFLICT(draft_key) DO UPDATE SET revision=excluded.revision,record=excluded.record',
      )
      .run(draft.key, draft.revision, this.placementRecord(draft));
  }
  private savedRow(row: Record<string, unknown>): SavedClusterConfiguration {
    const saved = decodeSavedClusterConfiguration(this.hydrated(this.json(row.record), false));
    if (saved.id !== row.configuration_id || saved.revision !== row.revision)
      throw Error('UNSUPPORTED_CONFIGURATION');
    return saved;
  }
  private json(text: unknown): unknown {
    if (typeof text !== 'string' || Buffer.byteLength(text) > 16384)
      throw Error('UNSUPPORTED_CONFIGURATION');
    return JSON.parse(text) as unknown;
  }
  private key(key: string): void {
    if (
      !/^model:[a-f0-9]{64}$/u.test(key) &&
      !/^config:[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(key)
    )
      throw Error('INVALID_CLUSTER_CONFIGURATION');
  }
  private configId(id: string): void {
    this.key(`config:${id}`);
  }
  private bind(key: string, modelId: string, id: string | null): void {
    if (key !== (id ? `config:${id}` : `model:${modelId}`))
      throw Error('INVALID_CLUSTER_CONFIGURATION');
  }
  private revision(expected: number | null, actual: number | null): void {
    if (
      expected !== null &&
      (!Number.isSafeInteger(expected) || expected < 1 || expected >= Number.MAX_SAFE_INTEGER)
    )
      throw Error('INVALID_CLUSTER_CONFIGURATION');
    if (expected !== actual) throw Error('STALE_CONFIGURATION');
  }
}
