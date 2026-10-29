import { useEffect, useState, useRef } from 'react';
import type {
  AssignmentIssue,
  ClusterBridge,
  ClusterDraft,
  ClusterEdit,
  ClusterReply,
  RawGpuRun,
  SavedClusterConfiguration,
  ClusterCanvasLayout,
} from '../../../shared/cluster-configuration';
type Entry = {
  key: string;
  raw: ClusterEdit;
  past: ClusterEdit[];
  future: ClusterEdit[];
  saved: SavedClusterConfiguration | null;
  draft: ClusterDraft | null;
  sequence: number;
  tail: Promise<void>;
  error: string | null;
  issues: readonly AssignmentIssue[];
  busy: boolean;
};
function baseline(saved: SavedClusterConfiguration): ClusterEdit {
  return {
    modelId: saved.modelId,
    load: saved.load,
    ...(saved.proposerDevice === undefined ? {} : { proposerDevice: saved.proposerDevice }),
    runs: saved.runs.map((run) => ({
      uuid: run.uuid,
      first: String(run.first),
      last: String(run.last),
    })),
    ...(saved.canvas ? { canvas: saved.canvas } : {}),
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
    canvas: edit.canvas,
    proposerDevice: edit.proposerDevice,
    runs: [...edit.runs].sort((a, b) => (a.uuid < b.uuid ? -1 : a.uuid > b.uuid ? 1 : 0)),
  });
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}
function hasAssignments(edit: ClusterEdit): boolean {
  return edit.runs.some((run) => Boolean(run.first.trim() || run.last.trim()));
}
/** Assignment edits stay in memory; Save, planning and Run explicitly synchronize a session draft. */
export function useClusterConfigurations(bridge: ClusterBridge | undefined) {
  const [snapshot, setSnapshot] = useState<{
    entry: Entry | undefined;
    configurations: readonly SavedClusterConfiguration[];
    planning: boolean;
    error: string | null;
  }>({ entry: undefined, configurations: [], planning: false, error: null });
  const entries = useRef(new Map<string, Entry>());
  const modelSelections = useRef(new Map<string, string>());
  const selected = useRef<string | null>(null);
  const selectionGeneration = useRef(0);
  const planning = useRef(false);
  const preparingRun = useRef(false);
  const configurations = useRef<readonly SavedClusterConfiguration[]>([]);
  const readError = useRef<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const departure = useRef<(() => void | Promise<void>) | null>(null);
  const [leaveRequested, setLeaveRequested] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const resolvingDeparture = useRef(false);
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
    modelSelections.current.set(modelId, key);
    selected.current = key;
    readError.current = null;
    refresh();
    if (entries.current.has(key) || !bridge) return;
    try {
      const reply = success(await bridge.command({ action: 'read', modelId, configurationId }));
      if (!reply.load && !reply.draft && !reply.configuration)
        throw Error('Configuration settings unavailable.');
      const raw = reply.draft
        ? {
            modelId: reply.draft.modelId,
            load: reply.draft.load,
            runs: reply.draft.runs,
            ...(reply.draft.proposerDevice === undefined
              ? {}
              : { proposerDevice: reply.draft.proposerDevice }),
            ...(reply.draft.canvas ? { canvas: reply.draft.canvas } : {}),
          }
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
  };
  /** Rehydrate load settings after model defaults change, preserving exact placement edits/history. */
  const refreshModel = async (modelId: string) => {
    if (!bridge) return;
    const id = modelId.replace(/^model-/u, '');
    await Promise.all(
      [...entries.current.values()]
        .filter((entry) => entry.raw.modelId === id)
        .map((entry) =>
          enqueue(entry, async () => {
            const reply = success(
              await bridge.command({
                action: 'read',
                modelId: id,
                configurationId: entry.saved?.id ?? null,
              }),
            );
            const load = reply.load;
            if (!load) throw Error('Configuration settings unavailable.');
            entry.raw = { ...entry.raw, load };
            entry.past = entry.past.map((edit) => ({ ...edit, load }));
            entry.future = entry.future.map((edit) => ({ ...edit, load }));
            entry.saved = reply.configuration;
            entry.draft = reply.draft;
            configurations.current = reply.configurations;
            refresh();
          }),
        ),
    );
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
  const setProposerDevice = (proposerDevice: string) => {
    if (
      proposerDevice !== 'auto' &&
      proposerDevice !== 'cpu' &&
      !/^(?:peer:[a-f0-9]{64}:)?GPU-[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}$/u.test(
        proposerDevice,
      )
    )
      return;
    const entry = current();
    if (!entry || !bridge || entry.busy || planning.current) return;
    const raw = { ...entry.raw, proposerDevice };
    if (sameEdit(entry.raw, raw)) return;
    entry.past = [...entry.past, entry.raw];
    entry.future = [];
    write(entry, raw);
  };
  const editCanvas = (canvas: ClusterCanvasLayout) => {
    const entry = current();
    if (!entry || !bridge || entry.busy || planning.current) return;
    const raw = { ...entry.raw, canvas };
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
    // Utility ownership can restart between explicit actions; retain saved-revision conflicts.
    const latest = success(
      await bridge!.command({
        action: 'read',
        modelId: entry.raw.modelId,
        configurationId: entry.saved?.id ?? null,
      }),
    );
    if (entry.saved && latest.configuration?.revision !== entry.saved.revision)
      throw Error('STALE_CONFIGURATION');
    if (entry.draft && latest.draft && entry.draft.revision !== latest.draft.revision)
      throw Error('STALE_CONFIGURATION');
    entry.draft = latest.draft;
    if (!entry.draft || !sameEdit(entry.raw, entry.draft)) {
      const reply = success(
        await bridge!.command({
          action: 'edit',
          key: entry.key,
          expectedRevision: entry.draft?.revision ?? null,
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
      if (modelSelections.current.get(entry.raw.modelId) === entry.key)
        modelSelections.current.set(entry.raw.modelId, nextKey);
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
    if (!entry) return true;
    if (!bridge || entry.busy || planning.current) return false;
    const sequence = entry.sequence;
    let discarded = false;
    await enqueue(entry, async () => {
      if (entry.draft) {
        const reply = success(
          await bridge.command({
            action: 'discard',
            key: entry.key,
            revision: entry.draft.revision,
          }),
        );
        entry.draft = reply.draft;
      }
      if (sequence === entry.sequence) {
        const { proposerDevice: discardedDevice, ...remaining } = entry.raw;
        void discardedDevice;
        entry.raw = entry.saved ? baseline(entry.saved) : { ...remaining, runs: [] };
        entry.past = [];
        entry.future = [];
        entry.issues = [];
        entry.error = null;
        discarded = true;
      }
      refresh();
    });
    return discarded;
  };
  const dirty = (entry: Entry | undefined) =>
    !!entry &&
    (entry.saved
      ? !sameEdit(entry.raw, baseline(entry.saved))
      : entry.raw.proposerDevice !== undefined || hasAssignments(entry.raw));
  const requestLeave = async (action: () => void | Promise<void>) => {
    if (departure.current || resolvingDeparture.current || planning.current || current()?.busy)
      return;
    if (dirty(current())) {
      departure.current = action;
      setLeaveRequested(true);
      return;
    }
    const entry = current();
    if (entry) {
      entry.past = [];
      entry.future = [];
      entry.error = null;
      entry.issues = [];
      refresh();
    }
    await action();
  };
  const cancelLeave = () => {
    if (resolvingDeparture.current) return;
    departure.current = null;
    setLeaveRequested(false);
  };
  const finishLeave = async (saveName: string | null | undefined) => {
    const action = departure.current;
    if (!action || resolvingDeparture.current) return false;
    resolvingDeparture.current = true;
    setLeaving(true);
    try {
      if (saveName === undefined) {
        if (!(await discard())) return false;
      } else if (!(await save(saveName))) return false;
      departure.current = null;
      setLeaveRequested(false);
      await action();
      return true;
    } finally {
      resolvingDeparture.current = false;
      setLeaving(false);
    }
  };
  const remove = async (configuration: SavedClusterConfiguration): Promise<boolean> => {
    if (!bridge || deleting || planning.current) return false;
    const key = `config:${configuration.id}`;
    const entry = entries.current.get(key);
    if (entry?.busy) return false;
    if (entry) entry.busy = true;
    setDeleting(true);
    try {
      await entry?.tail;
      const reply = success(
        await bridge.command({
          action: 'delete',
          id: configuration.id,
          revision: configuration.revision,
        }),
      );
      configurations.current = reply.configurations;
      entries.current.delete(key);
      if (modelSelections.current.get(configuration.modelId) === key)
        modelSelections.current.delete(configuration.modelId);
      if (selected.current === key) await select(configuration.modelId, null);
      refresh();
      return true;
    } catch {
      const message = 'Could not delete the configuration. It is still here.';
      if (entry) entry.error = message;
      readError.current = message;
      refresh();
      return false;
    } finally {
      if (entry) entry.busy = false;
      setDeleting(false);
      refresh();
    }
  };
  const autoPlace = async (devices?: readonly string[]) => {
    const eligible = devices ? [...devices] : undefined;
    const entry = current();
    if (!entry || !bridge || entry.busy || planning.current) return;
    const generation = selectionGeneration.current;
    planning.current = true;
    entry.error = null;
    entry.issues = [];
    refresh();
    await enqueue(entry, async () => {
      if (generation !== selectionGeneration.current) return;
      await ensureDraft(entry);
      const sequence = entry.sequence;
      const result = await bridge.command({
        action: 'auto-place',
        key: entry.key,
        revision: entry.draft!.revision,
        ...(eligible ? { devices: eligible } : {}),
      });
      if (sequence !== entry.sequence || generation !== selectionGeneration.current) return;
      const reply = success(result);
      if (reply.draft) {
        entry.draft = reply.draft;
        const raw = {
          modelId: reply.draft.modelId,
          load: reply.draft.load,
          runs: reply.draft.runs,
          ...(reply.draft.proposerDevice === undefined
            ? {}
            : { proposerDevice: reply.draft.proposerDevice }),
          ...(reply.draft.canvas ? { canvas: reply.draft.canvas } : {}),
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
      if (!hasAssignments(entry.raw))
        throw Error('Choose automatic or manual layer assignment first.');
      entry.busy = true;
      refresh();
      let target: { key: string; revision: number; modelId: string } | null = null;
      await enqueue(entry, async () => {
        if (!isCurrent()) throw Error('Model selection changed. Run the selected model again.');
        await ensureDraft(entry);
        if (!isCurrent()) throw Error('Model selection changed. Run the selected model again.');
        if (
          !entry.draft ||
          entry.draft.modelId !== entry.raw.modelId ||
          !sameEdit(entry.raw, entry.draft)
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
    dirty: dirty(entry),
    planning: snapshot.planning,
    pending: deleting || leaving || !!entry?.busy,
    saving: deleting || (entry?.busy ?? false),
    deleting,
    canUndo: !!entry?.past.length && !entry.busy && !snapshot.planning,
    canRedo: !!entry?.future.length && !entry.busy && !snapshot.planning,
    error: entry?.error ?? snapshot.error,
    issues: entry?.issues ?? [],
    selectModel: (modelId: string) => {
      const id = modelId.replace(/^model-/u, '');
      const entry = entries.current.get(modelSelections.current.get(id) ?? '');
      const configurationId = entry?.saved?.id ?? null;
      const key = configurationId ? `config:${configurationId}` : `model:${id}`;
      if (selected.current === key) return Promise.resolve();
      return requestLeave(() => select(id, configurationId));
    },
    selectConfiguration: (configuration: SavedClusterConfiguration) => {
      if (selected.current === `config:${configuration.id}`) return Promise.resolve();
      return requestLeave(() => select(configuration.modelId, configuration.id));
    },
    requestLeave,
    leaveRequested,
    leaving,
    cancelLeave,
    saveAndLeave: (name: string | null) => finishLeave(name),
    discardAndLeave: () => finishLeave(undefined),
    refreshModel,
    edit,
    editCanvas,
    setProposerDevice,
    undo: () => moveHistory('undo'),
    redo: () => moveHistory('redo'),
    save,
    discard,
    remove,
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
