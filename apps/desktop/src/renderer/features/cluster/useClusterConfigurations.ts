import { useEffect, useState, useRef } from 'react';
import type {
  AssignmentIssue,
  ClusterBridge,
  ClusterDraft,
  ClusterEdit,
  ClusterReply,
  RawGpuRun,
  SavedClusterConfiguration,
} from '../../../shared/cluster-configuration';
type Entry = {
  key: string;
  raw: ClusterEdit;
  past: ClusterEdit[];
  future: ClusterEdit[];
  saved: SavedClusterConfiguration | null;
  draft: ClusterDraft | null;
  sequence: number;
  acknowledged: number;
  tail: Promise<void>;
  error: string | null;
  issues: readonly AssignmentIssue[];
  busy: boolean;
};
function baseline(saved: SavedClusterConfiguration): ClusterEdit {
  return {
    modelId: saved.modelId,
    load: saved.load,
    runs: saved.runs.map((run) => ({
      uuid: run.uuid,
      first: String(run.first),
      last: String(run.last),
    })),
  };
}
function success(reply: ClusterReply) {
  if (!reply.ok) throw Error(reply.error);
  return reply;
}
function sameEdit(left: ClusterEdit, right: ClusterEdit): boolean {
  // Row order is presentation; raw values and device ownership still compare exactly.
  const normalize = (edit: ClusterEdit) => ({
    modelId: edit.modelId,
    runs: [...edit.runs].sort((a, b) => (a.uuid < b.uuid ? -1 : a.uuid > b.uuid ? 1 : 0)),
  });
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}
function hasAssignments(edit: ClusterEdit): boolean {
  return edit.runs.some((run) => Boolean(run.first.trim() || run.last.trim()));
}
/** Acknowledged drafts survive page unmount; each key owns a serial durable write queue. */
export function useClusterConfigurations(bridge: ClusterBridge | undefined) {
  const [snapshot, setSnapshot] = useState<{
    entry: Entry | undefined;
    configurations: readonly SavedClusterConfiguration[];
    planning: boolean;
    error: string | null;
  }>({ entry: undefined, configurations: [], planning: false, error: null });
  const entries = useRef(new Map<string, Entry>());
  const selected = useRef<string | null>(null);
  const selectionGeneration = useRef(0);
  const planning = useRef(false);
  const preparingRun = useRef(false);
  const configurations = useRef<readonly SavedClusterConfiguration[]>([]);
  const readError = useRef<string | null>(null);
  const refresh = () => {
    const entry = selected.current ? entries.current.get(selected.current) : undefined;
    setSnapshot({
      entry: entry ? { ...entry } : undefined,
      configurations: configurations.current,
      planning: planning.current,
      error: readError.current,
    });
  };
  useEffect(() => {
    if (bridge)
      void bridge
        .command({ action: 'list' })
        .then((reply) => {
          configurations.current = success(reply).configurations;
          refresh();
        })
        .catch(() => {
          readError.current = 'Configurations could not be read.';
          refresh();
        });
  }, [bridge]);
  const current = () => (selected.current ? entries.current.get(selected.current) : undefined);
  const enqueue = (entry: Entry, operation: () => Promise<void>) => {
    entry.tail = entry.tail
      .catch(() => {})
      .then(operation)
      .catch((error) => {
        entry.error = error instanceof Error ? error.message : 'Configuration could not be saved.';
        refresh();
      });
    return entry.tail;
  };
  const select = async (modelId: string, configurationId: string | null) => {
    const generation = ++selectionGeneration.current;
    if (planning.current && bridge) {
      planning.current = false;
      void bridge.command({ action: 'cancel-planning' }).catch(() => {});
    }
    const key = configurationId ? `config:${configurationId}` : `model:${modelId}`;
    selected.current = key;
    readError.current = null;
    refresh();
    if (entries.current.has(key) || !bridge) return;
    try {
      const reply = success(await bridge.command({ action: 'read', modelId, configurationId }));
      if (!reply.load && !reply.draft && !reply.configuration)
        throw Error('Configuration settings unavailable.');
      const raw = reply.draft
        ? { modelId: reply.draft.modelId, load: reply.draft.load, runs: reply.draft.runs }
        : reply.configuration
          ? baseline(reply.configuration)
          : { modelId, load: reply.load!, runs: [] };
      if (raw.modelId !== modelId) throw Error('Configuration model does not match selection.');
      const initial = reply.configuration ? baseline(reply.configuration) : { ...raw, runs: [] };
      if (!entries.current.has(key))
        entries.current.set(key, {
          key,
          raw,
          past: sameEdit(raw, initial) ? [] : [initial],
          future: [],
          saved: reply.configuration,
          draft: reply.draft,
          sequence: 0,
          acknowledged: 0,
          tail: Promise.resolve(),
          error: null,
          issues: [],
          busy: false,
        });
      if (generation === selectionGeneration.current) refresh();
    } catch (error) {
      if (generation === selectionGeneration.current) {
        readError.current = error instanceof Error ? error.message : 'Configuration unavailable.';
        refresh();
      }
    }
  };
  const write = (entry: Entry, raw: ClusterEdit) => {
    if (!bridge) return;
    entry.raw = raw;
    entry.sequence++;
    entry.error = null;
    entry.issues = [];
    refresh();
    const sequence = entry.sequence;
    void enqueue(entry, async () => {
      const reply = success(
        await bridge.command({
          action: 'edit',
          key: entry.key,
          expectedRevision: entry.draft?.revision ?? null,
          edit: raw,
        }),
      );
      if (!reply.draft) throw Error('Draft acknowledgement missing.');
      entry.draft = reply.draft;
      entry.acknowledged = sequence;
      if (sequence === entry.sequence) entry.error = null;
      refresh();
    });
  };
  const edit = (runs: readonly RawGpuRun[]) => {
    const entry = current();
    if (!entry || !bridge || entry.busy || planning.current) return;
    const raw = { ...entry.raw, runs };
    if (sameEdit(entry.raw, raw)) return;
    entry.past = [...entry.past, entry.raw];
    entry.future = [];
    write(entry, raw);
  };
  const moveHistory = (direction: 'undo' | 'redo') => {
    const entry = current();
    if (!entry || !bridge || entry.busy || planning.current) return;
    const source = direction === 'undo' ? entry.past : entry.future;
    const raw = source.at(-1);
    if (!raw) return;
    if (direction === 'undo') {
      entry.past = source.slice(0, -1);
      entry.future = [...entry.future, entry.raw];
    } else {
      entry.future = source.slice(0, -1);
      entry.past = [...entry.past, entry.raw];
    }
    write(entry, raw);
  };
  const ensureDraft = async (entry: Entry) => {
    if (!entry.draft) {
      const reply = success(
        await bridge!.command({
          action: 'edit',
          key: entry.key,
          expectedRevision: null,
          edit: entry.raw,
        }),
      );
      if (!reply.draft) throw Error('Draft acknowledgement missing.');
      entry.draft = reply.draft;
    }
  };
  const save = async (name: string | null) => {
    const entry = current();
    if (!entry || !bridge) return false;
    if (entry.busy || planning.current) return false;
    entry.busy = true;
    entry.error = null;
    refresh();
    let saved = false;
    await enqueue(entry, async () => {
      if (entry.acknowledged !== entry.sequence)
        throw Error('Changes have not been durably saved. Edit again to retry.');
      await ensureDraft(entry);
      const sequence = entry.sequence;
      const reply = success(
        await bridge.command({
          action: 'save',
          key: entry.key,
          revision: entry.draft!.revision,
          name,
        }),
      );
      if (sequence === entry.sequence) entry.issues = reply.issues;
      if (reply.issues.length) {
        if (sequence !== entry.sequence) return;
        entry.error =
          'Use whole numbers and cover all model layers exactly once, without gaps or overlaps.';
        refresh();
        return;
      }
      if (!reply.configuration) throw Error('Save acknowledgement missing.');
      entry.saved = reply.configuration;
      entry.draft = reply.draft;
      const nextKey = `config:${reply.configuration.id}`;
      entries.current.set(nextKey, entry);
      if (nextKey !== entry.key) entries.current.delete(entry.key);
      if (selected.current === entry.key) selected.current = nextKey;
      entry.key = nextKey;
      configurations.current = reply.configurations;
      saved = sequence === entry.sequence;
      if (saved) {
        entry.past = [];
        entry.future = [];
      }
      refresh();
    });
    entry.busy = false;
    refresh();
    return saved;
  };
  const discard = async () => {
    const entry = current();
    if (!entry || !bridge) return;
    const sequence = entry.sequence;
    await enqueue(entry, async () => {
      if (!entry.draft) return;
      const reply = success(
        await bridge.command({ action: 'discard', key: entry.key, revision: entry.draft.revision }),
      );
      entry.draft = reply.draft;
      if (sequence === entry.sequence) {
        entry.raw = entry.saved ? baseline(entry.saved) : { ...entry.raw, runs: [] };
        entry.past = [];
        entry.future = [];
        entry.issues = [];
        entry.error = null;
      }
      refresh();
    });
  };
  const autoPlace = async () => {
    const entry = current();
    if (!entry || !bridge || entry.busy || planning.current) return;
    const generation = selectionGeneration.current;
    planning.current = true;
    refresh();
    await enqueue(entry, async () => {
      if (generation !== selectionGeneration.current) return;
      if (entry.acknowledged !== entry.sequence)
        throw Error('Changes have not been durably saved. Edit again to retry.');
      await ensureDraft(entry);
      const sequence = entry.sequence;
      const result = await bridge.command({
        action: 'auto-place',
        key: entry.key,
        revision: entry.draft!.revision,
      });
      if (sequence !== entry.sequence || generation !== selectionGeneration.current) return;
      const reply = success(result);
      if (reply.draft) {
        entry.draft = reply.draft;
        const raw = {
          modelId: reply.draft.modelId,
          load: reply.draft.load,
          runs: reply.draft.runs,
        };
        if (!sameEdit(entry.raw, raw)) {
          entry.past = [...entry.past, entry.raw];
          entry.future = [];
          entry.raw = raw;
        }
        entry.error = null;
        entry.issues = [];
      }
      refresh();
    });
    if (generation === selectionGeneration.current) planning.current = false;
    refresh();
  };
  const prepareRun = async (): Promise<{
    key: string;
    revision: number;
    modelId: string;
  } | null> => {
    const entry = current();
    if (!entry || !bridge) {
      readError.current = 'Choose a model before running.';
      refresh();
      return null;
    }
    if (entry.busy || planning.current || preparingRun.current) {
      entry.error = 'Wait for the current operation before running.';
      refresh();
      return null;
    }
    const generation = selectionGeneration.current;
    const key = entry.key;
    const isCurrent = () =>
      generation === selectionGeneration.current && selected.current === key && current() === entry;
    preparingRun.current = true;
    try {
      await entry.tail;
      if (!isCurrent()) throw Error('Model selection changed. Run the selected model again.');
      if (entry.acknowledged !== entry.sequence)
        throw Error('Changes have not been durably saved. Edit again to retry.');
      if (!hasAssignments(entry.raw))
        throw Error('Choose automatic or manual layer assignment first.');
      entry.busy = true;
      refresh();
      let target: { key: string; revision: number; modelId: string } | null = null;
      await enqueue(entry, async () => {
        if (!isCurrent()) throw Error('Model selection changed. Run the selected model again.');
        if (entry.acknowledged !== entry.sequence)
          throw Error('Changes have not been durably saved. Edit again to retry.');
        await ensureDraft(entry);
        if (!isCurrent()) throw Error('Model selection changed. Run the selected model again.');
        if (
          !entry.draft ||
          entry.draft.modelId !== entry.raw.modelId ||
          !sameEdit(entry.raw, {
            modelId: entry.draft.modelId,
            load: entry.draft.load,
            runs: entry.draft.runs,
          })
        )
          throw Error('Draft acknowledgement missing.');
        target = { key, revision: entry.draft.revision, modelId: entry.raw.modelId };
        entry.error = null;
      });
      return isCurrent() ? target : null;
    } catch (error) {
      entry.error = error instanceof Error ? error.message : 'Layer assignment is unavailable.';
      if (!isCurrent()) readError.current = entry.error;
      return null;
    } finally {
      entry.busy = false;
      preparingRun.current = false;
      refresh();
    }
  };
  const entry = snapshot.entry;
  return {
    configurations: snapshot.configurations,
    selection: entry
      ? { modelId: entry.raw.modelId, configurationId: entry.saved?.id ?? null }
      : null,
    raw: entry?.raw ?? null,
    draft: entry?.draft ?? null,
    saved: entry?.saved ?? null,
    hasAssignments: !!entry && hasAssignments(entry.raw),
    dirty:
      !!entry &&
      (entry.saved ? !sameEdit(entry.raw, baseline(entry.saved)) : hasAssignments(entry.raw)),
    planning: snapshot.planning,
    pending: !!entry && (entry.busy || entry.sequence !== entry.acknowledged),
    saving: entry?.busy ?? false,
    canUndo: !!entry?.past.length && !entry.busy && !snapshot.planning,
    canRedo: !!entry?.future.length && !entry.busy && !snapshot.planning,
    error: entry?.error ?? snapshot.error,
    issues: entry?.issues ?? [],
    selectModel: (modelId: string) => select(modelId.replace(/^model-/u, ''), null),
    selectConfiguration: (configuration: SavedClusterConfiguration) =>
      select(configuration.modelId, configuration.id),
    edit,
    undo: () => moveHistory('undo'),
    redo: () => moveHistory('redo'),
    save,
    discard,
    autoPlace,
    prepareRun,
    cancelPlanning: async () => {
      ++selectionGeneration.current;
      planning.current = false;
      refresh();
      if (bridge) await bridge.command({ action: 'cancel-planning' });
    },
  };
}
export type ClusterConfigurations = ReturnType<typeof useClusterConfigurations>;
