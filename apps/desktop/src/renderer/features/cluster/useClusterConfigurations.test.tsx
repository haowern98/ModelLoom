import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useClusterConfigurations } from './useClusterConfigurations';
import type {
  ClusterBridge,
  ClusterCommand,
  ClusterReply,
  CapturedClusterLoad,
  ClusterDraft,
  SavedClusterConfiguration,
} from '../../../shared/cluster-configuration';
const load = { defaults: {}, cacheK: 'f16', cacheV: 'f16' } as CapturedClusterLoad;

it('captures canvas GPU candidates before awaiting draft synchronization', async () => {
  const fixture = historyBridge();
  const original = fixture.bridge.command;
  let release!: () => void;
  fixture.bridge.command = vi.fn(async (command) => {
    if (command.action === 'edit')
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    return original(command);
  });
  const { result } = renderHook(() => useClusterConfigurations(fixture.bridge));
  await act(() => result.current.selectModel('a'.repeat(64)));
  const gpu = 'GPU-11111111-1111-1111-1111-111111111111';
  const devices = [gpu];
  let planning!: Promise<void>;
  act(() => {
    planning = result.current.autoPlace(devices);
  });
  await waitFor(() => expect(release).toBeDefined());
  devices.push('GPU-22222222-2222-2222-2222-222222222222');
  await act(async () => {
    release();
    await planning;
  });
  expect(fixture.command).toHaveBeenCalledWith(
    expect.objectContaining({ action: 'auto-place', devices: [gpu] }),
  );
});

it('switches after a successful Save without requiring another persistence operation', async () => {
  const fixture = historyBridge();
  const original = fixture.bridge.command;
  fixture.bridge.command = vi.fn((command) =>
    command.action === 'discard'
      ? Promise.resolve({ ok: false as const, error: 'CONFIGURATION_UNAVAILABLE' as const })
      : original(command),
  );
  const { result } = renderHook(() => useClusterConfigurations(fixture.bridge));
  await act(() => result.current.selectConfiguration(fixture.configuration));
  act(() => result.current.edit([{ uuid: 'gpu', first: '0', last: '6' }]));
  await act(() => result.current.selectModel('b'.repeat(64)));
  await act(async () => expect(await result.current.saveAndLeave(null)).toBe(true));
  expect(result.current.selection?.modelId).toBe('b'.repeat(64));
  await act(() => result.current.selectModel(fixture.configuration.modelId));
  expect(result.current.dirty).toBe(false);
  await act(() => result.current.selectModel('b'.repeat(64)));
  expect(result.current.selection?.modelId).toBe('b'.repeat(64));
  expect(
    vi.mocked(fixture.bridge.command).mock.calls.some(([input]) => input.action === 'discard'),
  ).toBe(false);
});

it('keeps manual assignment edits in memory until an explicit save, plan or run', async () => {
  const fixture = historyBridge();
  const { result } = renderHook(() => useClusterConfigurations(fixture.bridge));
  await act(() => result.current.selectModel('a'.repeat(64)));
  act(() => result.current.edit([{ uuid: 'gpu', first: '0', last: '3' }]));
  act(() => result.current.undo());
  act(() => result.current.redo());
  await act(() => Promise.resolve());
  expect(result.current.raw?.runs[0]?.last).toBe('3');
  expect(
    fixture.command.mock.calls.some(
      ([input]) => input.action === 'edit' || input.action === 'save',
    ),
  ).toBe(false);
});

it('prompts before switching an unsaved automatic assignment and discards it only on confirmation', async () => {
  const fixture = historyBridge();
  const { result } = renderHook(() => useClusterConfigurations(fixture.bridge));
  const first = 'a'.repeat(64),
    second = 'b'.repeat(64);
  await act(() => result.current.selectModel(first));
  await act(() => result.current.autoPlace());
  await act(() => result.current.selectModel(second));
  expect(result.current.selection?.modelId).toBe(first);
  expect(result.current.leaveRequested).toBe(true);
  act(() => result.current.cancelLeave());
  expect(result.current.raw?.runs[0]?.last).toBe('7');
  await act(() => result.current.selectModel(second));
  await act(() => result.current.discardAndLeave());
  expect(result.current.selection?.modelId).toBe(second);
  await act(() => result.current.selectModel(first));
  expect(result.current.raw?.runs).toEqual([]);
  expect(result.current.canUndo).toBe(false);
});

it('restores saved assignments after discarding edits and blocks departure after failed Save', async () => {
  const fixture = historyBridge();
  const { result } = renderHook(() => useClusterConfigurations(fixture.bridge));
  await act(() => result.current.selectConfiguration(fixture.configuration));
  act(() => result.current.edit([{ uuid: 'gpu', first: '0', last: '-' }]));
  await act(() => result.current.selectModel('b'.repeat(64)));
  await act(async () => expect(await result.current.saveAndLeave(null)).toBe(false));
  expect(result.current.selection?.modelId).toBe(fixture.configuration.modelId);
  expect(result.current.raw?.runs[0]?.last).toBe('-');
  await act(() => result.current.discardAndLeave());
  await act(() => result.current.selectConfiguration(fixture.configuration));
  expect(result.current.raw?.runs[0]?.last).toBe('7');
  expect(result.current.dirty).toBe(false);
});

it('refreshes captured model settings without losing unsaved placement text or Undo history', async () => {
  const fixture = historyBridge();
  const original = fixture.bridge.command;
  let updated = false;
  const nextLoad = { ...load, defaults: { ...load.defaults, contextLength: 2048 } };
  fixture.bridge.command = vi.fn(async (command) => {
    const reply = await original(command);
    if (!updated || command.action !== 'read' || !reply.ok) return reply;
    return {
      ...reply,
      load: nextLoad,
      configuration: reply.configuration ? { ...reply.configuration, load: nextLoad } : null,
      draft: reply.draft ? { ...reply.draft, load: nextLoad } : null,
    };
  });
  const { result } = renderHook(() => useClusterConfigurations(fixture.bridge));
  await act(() => result.current.selectConfiguration(fixture.configuration));
  act(() => result.current.edit([{ uuid: 'gpu', first: '0', last: '-' }]));
  updated = true;
  await act(() => result.current.refreshModel(fixture.configuration.modelId));
  expect(result.current.raw?.load).toEqual(nextLoad);
  expect(result.current.draft).toBeNull();
  expect(result.current.raw?.runs[0]?.last).toBe('-');
  expect(result.current.dirty).toBe(true);
  act(() => result.current.undo());
  await waitFor(() => expect(result.current.pending).toBe(false));
  expect(result.current.raw?.runs[0]?.last).toBe('7');
  expect(result.current.raw?.load).toEqual(nextLoad);
  expect(result.current.dirty).toBe(false);
});

it('retains the selected configuration and its edits when deletion fails', async () => {
  const fixture = historyBridge();
  const original = fixture.bridge.command;
  fixture.bridge.command = vi.fn((command) =>
    command.action === 'delete'
      ? Promise.resolve({ ok: false as const, error: 'CONFIGURATION_UNAVAILABLE' as const })
      : original(command),
  );
  const { result } = renderHook(() => useClusterConfigurations(fixture.bridge));
  await act(() => result.current.selectConfiguration(fixture.configuration));
  act(() => result.current.edit([{ uuid: 'gpu', first: '0', last: '6' }]));
  await act(async () => expect(await result.current.remove(fixture.configuration)).toBe(false));
  expect(result.current.saved).toEqual(fixture.configuration);
  expect(result.current.raw?.runs[0]?.last).toBe('6');
  expect(result.current.configurations).toEqual([fixture.configuration]);
  expect(result.current.error).toContain('Could not delete');
});

it('restores the independent model draft after deleting the selected saved configuration', async () => {
  const fixture = historyBridge();
  const original = fixture.bridge.command;
  fixture.bridge.command = vi.fn((command) =>
    command.action === 'delete'
      ? Promise.resolve({
          ok: true as const,
          configurations: [],
          configuration: null,
          draft: null,
          load: null,
          issues: [],
        })
      : original(command),
  );
  const { result } = renderHook(() => useClusterConfigurations(fixture.bridge));
  await act(() => result.current.selectModel(fixture.configuration.modelId));
  act(() => result.current.edit([{ uuid: 'gpu', first: '0', last: '6' }]));
  await act(() => result.current.selectConfiguration(fixture.configuration));
  await act(async () => expect(await result.current.remove(fixture.configuration)).toBe(true));
  expect(result.current.saved).toBeNull();
  expect(result.current.raw?.runs[0]?.last).toBe('6');
  expect(result.current.configurations).toEqual([]);
  expect(result.current.selection?.configurationId).toBeNull();
});

it('does not mark placement dirty or add Undo when only hydrated model defaults differ', async () => {
  const fixture = historyBridge();
  const original = fixture.bridge.command;
  fixture.bridge.command = vi.fn(async (command) => {
    const reply = await original(command);
    if (command.action !== 'read' || !reply.ok || !reply.configuration) return reply;
    const configuration = reply.configuration;
    return {
      ...reply,
      draft: {
        key: `config:${configuration.id}`,
        configurationId: configuration.id,
        revision: 2,
        baseSavedRevision: configuration.revision,
        modelId: configuration.modelId,
        load: { ...configuration.load, cacheV: 'q8_0' as const },
        runs: configuration.runs.map((run) => ({
          uuid: run.uuid,
          first: String(run.first),
          last: String(run.last),
        })),
      },
    };
  });
  const { result } = renderHook(() => useClusterConfigurations(fixture.bridge));
  await act(() => result.current.selectConfiguration(fixture.configuration));
  expect(result.current.raw?.load.cacheV).toBe('q8_0');
  expect(result.current.dirty).toBe(false);
  expect(result.current.canUndo).toBe(false);
});

it('refuses empty drafts without automatic assignment and keeps prepared drafts runnable without Save', async () => {
  const fixture = historyBridge();
  const { result } = renderHook(() => useClusterConfigurations(fixture.bridge));
  const qwen = 'b'.repeat(64);
  const bonsai = 'a'.repeat(64);
  await act(() => result.current.selectModel(qwen));
  act(() => result.current.edit([{ uuid: 'gpu', first: '0', last: '7' }]));
  await act(() => result.current.selectModel(bonsai));
  await act(() => result.current.discardAndLeave());
  await act(async () => {
    expect(await result.current.prepareRun()).toBeNull();
  });
  expect(
    fixture.command.mock.calls
      .filter(([command]) => command.action === 'auto-place')
      .map(([command]) => ('key' in command ? command.key : null)),
  ).toEqual([]);
  act(() => result.current.edit([{ uuid: 'gpu', first: '', last: '' }]));
  await act(async () => expect(await result.current.prepareRun()).toBeNull());
  expect(result.current.dirty).toBe(false);
  await act(() => result.current.selectModel(qwen));
  act(() => result.current.edit([{ uuid: 'gpu', first: '0', last: '6' }]));
  await act(async () => {
    const first = result.current.prepareRun();
    expect(await result.current.prepareRun()).toBeNull();
    expect(await first).toEqual({ key: `model:${qwen}`, revision: 1, modelId: qwen });
  });
  expect(fixture.command.mock.calls.some(([command]) => command.action === 'save')).toBe(false);
});

it('blocks selection during planning and requires confirmation before leaving its result', async () => {
  const fixture = historyBridge();
  const original = fixture.bridge.command;
  let release!: () => void;
  fixture.bridge.command = vi.fn(async (command) => {
    if (command.action === 'auto-place')
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    return original(command);
  });
  const { result } = renderHook(() => useClusterConfigurations(fixture.bridge));
  await act(() => result.current.selectModel('b'.repeat(64)));
  let planning!: Promise<void>;
  act(() => {
    planning = result.current.autoPlace();
  });
  await waitFor(() => expect(release).toBeDefined());
  await act(() => result.current.selectModel('a'.repeat(64)));
  await act(async () => {
    release();
    await planning;
  });
  expect(result.current.selection?.modelId).toBe('b'.repeat(64));
  await act(() => result.current.selectModel('a'.repeat(64)));
  await act(() => result.current.discardAndLeave());
  expect(result.current.raw?.runs).toEqual([]);
  expect(result.current.planning).toBe(false);
  expect(fixture.command.mock.calls.some(([command]) => command.action === 'save')).toBe(false);
});

it('refuses Run when its explicit draft synchronization fails', async () => {
  const fixture = historyBridge();
  const original = fixture.bridge.command;
  fixture.bridge.command = vi.fn((command) =>
    command.action === 'edit'
      ? Promise.resolve({ ok: false as const, error: 'CONFIGURATION_UNAVAILABLE' as const })
      : original(command),
  );
  const { result } = renderHook(() => useClusterConfigurations(fixture.bridge));
  await act(() => result.current.selectModel('a'.repeat(64)));
  act(() => result.current.edit([{ uuid: 'gpu', first: '0', last: '7' }]));
  await act(async () => {
    expect(await result.current.prepareRun()).toBeNull();
  });
  expect(result.current.error).toBe('CONFIGURATION_UNAVAILABLE');
  expect(
    fixture.command.mock.calls.some(
      ([command]) => command.action === 'save' || command.action === 'auto-place',
    ),
  ).toBe(false);
});

function historyBridge() {
  let configuration: SavedClusterConfiguration = {
    id: 'saved',
    name: 'Laptop',
    revision: 1,
    modelId: 'a'.repeat(64),
    blockCount: 8,
    profileId: 'test',
    load,
    runs: [{ uuid: 'gpu', first: 0, last: 7 }],
  };
  const drafts = new Map<string, ClusterDraft>();
  let rejectAuto = false;
  const respond = (input: ClusterCommand): ClusterReply => {
    const reply = (draft: ClusterDraft | null) => ({
      ok: true as const,
      configurations: [configuration],
      configuration,
      draft,
      load,
      issues: [],
    });
    if (input.action === 'list') return reply(null);
    if (input.action === 'read')
      return {
        ...reply(
          drafts.get(
            input.configurationId ? `config:${input.configurationId}` : `model:${input.modelId}`,
          ) ?? null,
        ),
        configuration: input.configurationId ? configuration : null,
      };
    if (input.action === 'edit') {
      const previous = drafts.get(input.key);
      expect(input.expectedRevision).toBe(previous?.revision ?? null);
      const draft = {
        key: input.key,
        configurationId: input.key.startsWith('config:') ? 'saved' : null,
        revision: (previous?.revision ?? 0) + 1,
        baseSavedRevision: configuration.revision,
        ...input.edit,
      };
      drafts.set(input.key, draft);
      return reply(draft);
    }
    if (input.action === 'auto-place') {
      if (rejectAuto) return { ok: false, error: 'INSUFFICIENT_RESOURCES' };
      const previous = drafts.get(input.key)!;
      const draft = {
        ...previous,
        revision: previous.revision + 1,
        runs: [{ uuid: 'gpu', first: '0', last: '7' }],
      };
      drafts.set(input.key, draft);
      return reply(draft);
    }
    if (input.action === 'discard') {
      const previous = drafts.get(input.key)!;
      if (!previous.configurationId) {
        drafts.delete(input.key);
        return reply(null);
      }
      const draft = {
        ...previous,
        revision: previous.revision + 1,
        runs: configuration.runs.map((run) => ({
          uuid: run.uuid,
          first: String(run.first),
          last: String(run.last),
        })),
      };
      drafts.set(input.key, draft);
      return reply(draft);
    }
    if (input.action === 'save') {
      const draft = drafts.get(input.key)!;
      if (draft.runs.some((run) => run.first === '-' || run.last === '-'))
        return {
          ...reply(draft),
          issues: [{ uuid: 'gpu', field: 'last', code: 'invalid-integer' }],
        };
      configuration = {
        ...configuration,
        modelId: draft.modelId,
        revision: configuration.revision + 1,
        runs: draft.runs.map((run) => ({
          uuid: run.uuid,
          first: Number(run.first),
          last: Number(run.last),
        })),
      };
      const savedDraft = {
        ...draft,
        key: `config:${configuration.id}`,
        configurationId: configuration.id,
        revision: draft.revision + 1,
        baseSavedRevision: configuration.revision,
      };
      drafts.delete(input.key);
      drafts.set(savedDraft.key, savedDraft);
      return reply(savedDraft);
    }
    return reply(null);
  };
  const command = vi.fn<ClusterBridge['command']>((input) => Promise.resolve(respond(input)));
  return {
    bridge: { command },
    command,
    configuration,
    failAuto: () => {
      rejectAuto = true;
    },
    clearDrafts: () => drafts.clear(),
  };
}

it('synchronizes explicit Save after the utility has recreated its session drafts', async () => {
  const fixture = historyBridge();
  const { result } = renderHook(() => useClusterConfigurations(fixture.bridge));
  await act(() => result.current.selectConfiguration(fixture.configuration));
  act(() => result.current.edit([{ uuid: 'gpu', first: '0', last: '6' }]));
  await act(async () => expect(await result.current.save(null)).toBe(true));
  fixture.clearDrafts();
  act(() => result.current.edit([{ uuid: 'gpu', first: '0', last: '5' }]));
  await act(async () => expect(await result.current.save(null)).toBe(true));
  expect(result.current.raw?.runs[0]?.last).toBe('5');
});

it('undoes and redoes exact raw text in memory and clears branched redo', async () => {
  const fixture = historyBridge();
  const { result } = renderHook(() => useClusterConfigurations(fixture.bridge));
  await act(() => result.current.selectConfiguration(fixture.configuration));
  expect(result.current.canUndo).toBe(false);
  expect(result.current.canRedo).toBe(false);
  act(() => result.current.edit([{ uuid: 'gpu', first: '0', last: '-' }]));
  expect(result.current.canUndo).toBe(true);
  act(() => result.current.undo());
  expect(result.current.raw?.runs[0]?.last).toBe('7');
  expect(result.current.canRedo).toBe(true);
  act(() => result.current.redo());
  expect(result.current.raw?.runs[0]?.last).toBe('-');
  await waitFor(() => expect(result.current.pending).toBe(false));
  expect(
    fixture.command.mock.calls
      .filter(([input]) => input.action === 'edit')
      .map(([input]) => (input.action === 'edit' ? input.edit.runs[0]?.last : null)),
  ).toEqual([]);
  act(() => result.current.undo());
  act(() => result.current.edit([{ uuid: 'gpu', first: '0', last: '6' }]));
  expect(result.current.canRedo).toBe(false);
  await waitFor(() => expect(result.current.pending).toBe(false));
});

it('discards each model editor history explicitly before changing selection', async () => {
  const fixture = historyBridge();
  const { result } = renderHook(() => useClusterConfigurations(fixture.bridge));
  await act(() => result.current.selectConfiguration(fixture.configuration));
  act(() => result.current.edit([{ uuid: 'gpu', first: '0', last: '6' }]));
  await act(() => result.current.selectModel('b'.repeat(64)));
  expect(result.current.leaveRequested).toBe(true);
  await act(() => result.current.discardAndLeave());
  expect(result.current.canUndo).toBe(false);
  act(() => result.current.edit([{ uuid: 'gpu', first: '0', last: '3' }]));
  await act(() => result.current.selectConfiguration(fixture.configuration));
  await act(() => result.current.discardAndLeave());
  expect(result.current.raw?.runs[0]?.last).toBe('7');
  expect(result.current.canUndo).toBe(false);
  await act(() => result.current.selectModel('b'.repeat(64)));
  expect(result.current.raw?.runs).toEqual([]);
});

it('retains invalid draft history on failed Save and resets history only after successful Save', async () => {
  const fixture = historyBridge();
  const { result } = renderHook(() => useClusterConfigurations(fixture.bridge));
  await act(() => result.current.selectConfiguration(fixture.configuration));
  act(() => result.current.edit([{ uuid: 'gpu', first: '0', last: '-' }]));
  await act(async () => {
    expect(await result.current.save(null)).toBe(false);
  });
  expect(result.current.raw?.runs[0]?.last).toBe('-');
  expect(result.current.canUndo).toBe(true);
  act(() => result.current.edit([{ uuid: 'gpu', first: '0', last: '6' }]));
  await act(async () => {
    expect(await result.current.save(null)).toBe(true);
  });
  expect(result.current.canUndo).toBe(false);
  expect(result.current.canRedo).toBe(false);
  expect(result.current.dirty).toBe(false);
});

it('saves edits to the existing configuration before switching without creating another one', async () => {
  const fixture = historyBridge();
  const { result } = renderHook(() => useClusterConfigurations(fixture.bridge));
  await act(() => result.current.selectConfiguration(fixture.configuration));
  act(() => result.current.edit([{ uuid: 'gpu', first: '0', last: '6' }]));
  await act(() => result.current.selectModel('b'.repeat(64)));
  await act(async () => expect(await result.current.saveAndLeave(null)).toBe(true));
  expect(result.current.selection?.modelId).toBe('b'.repeat(64));
  await act(() => result.current.selectModel(fixture.configuration.modelId));
  expect(result.current.selection?.configurationId).toBe(fixture.configuration.id);
  expect(result.current.raw?.runs[0]?.last).toBe('6');
  expect(result.current.dirty).toBe(false);
  expect(result.current.configurations).toHaveLength(1);
});

it('saves a named automatic assignment only after the user chooses Save changes', async () => {
  const fixture = historyBridge();
  const { result } = renderHook(() => useClusterConfigurations(fixture.bridge));
  const first = 'a'.repeat(64),
    second = 'b'.repeat(64);
  await act(() => result.current.selectModel(first));
  await act(() => result.current.autoPlace());
  await act(() => result.current.selectModel(second));
  expect(fixture.command.mock.calls.some(([input]) => input.action === 'save')).toBe(false);
  await act(async () => expect(await result.current.saveAndLeave('Qwen placement')).toBe(true));
  expect(result.current.selection?.modelId).toBe(second);
  await act(() => result.current.selectModel(first));
  expect(result.current.raw?.runs).toEqual([{ uuid: 'gpu', first: '0', last: '7' }]);
  expect(result.current.dirty).toBe(false);
  expect(fixture.command).toHaveBeenCalledWith(
    expect.objectContaining({ action: 'save', name: 'Qwen placement' }),
  );
});

it('makes successful auto assignment one undoable draft change and preserves history on failure', async () => {
  const fixture = historyBridge();
  const { result } = renderHook(() => useClusterConfigurations(fixture.bridge));
  await act(() => result.current.selectConfiguration(fixture.configuration));
  act(() => result.current.edit([{ uuid: 'gpu', first: '0', last: '3' }]));
  await act(() => result.current.autoPlace());
  expect(result.current.raw?.runs[0]?.last).toBe('7');
  await act(() => result.current.autoPlace());
  act(() => result.current.undo());
  expect(result.current.raw?.runs[0]?.last).toBe('3');
  fixture.failAuto();
  await act(() => result.current.autoPlace());
  expect(result.current.raw?.runs[0]?.last).toBe('3');
  expect(result.current.canRedo).toBe(true);
  act(() => result.current.undo());
  expect(result.current.raw?.runs[0]?.last).toBe('7');
  expect(result.current.canUndo).toBe(false);
  expect(fixture.command.mock.calls.some(([input]) => input.action === 'save')).toBe(false);
  await waitFor(() => expect(result.current.pending).toBe(false));
});
it('treats saved GPU row order as presentation while preserving raw editor strings', async () => {
  const configuration = {
    id: 'saved',
    name: 'Laptop',
    revision: 1,
    modelId: 'a'.repeat(64),
    blockCount: 8,
    profileId: 'test',
    load,
    runs: [
      { uuid: 'a', first: 0, last: 3 },
      { uuid: 'b', first: 4, last: 7 },
    ],
  };
  const draft = {
    key: 'config:saved',
    configurationId: 'saved',
    modelId: configuration.modelId,
    revision: 2,
    baseSavedRevision: 1,
    load,
    runs: [
      { uuid: 'b', first: '4', last: '7' },
      { uuid: 'a', first: '0', last: '3' },
    ],
  };
  const bridge: ClusterBridge = {
    command: () =>
      Promise.resolve({
        ok: true,
        configurations: [configuration],
        configuration,
        draft,
        load,
        issues: [],
      }),
  };
  const { result } = renderHook(() => useClusterConfigurations(bridge));
  await act(async () => {
    await result.current.selectConfiguration(configuration);
  });
  expect(result.current.dirty).toBe(false);
  expect(result.current.raw?.runs).toEqual(draft.runs);
});
it('synchronizes the final editor text once on Save and blocks edits during its acknowledgement', async () => {
  const fixture = historyBridge();
  const original = fixture.bridge.command;
  let release!: () => void;
  fixture.bridge.command = vi.fn(async (command) => {
    if (command.action === 'edit')
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    return original(command);
  });
  const { result } = renderHook(() => useClusterConfigurations(fixture.bridge));
  await act(() => result.current.selectConfiguration(fixture.configuration));
  act(() => result.current.edit([{ uuid: 'gpu', first: '0', last: '-' }]));
  act(() => result.current.edit([{ uuid: 'gpu', first: '0', last: '6' }]));
  expect(fixture.bridge.command).not.toHaveBeenCalledWith(
    expect.objectContaining({ action: 'edit' }),
  );
  let saving!: Promise<boolean>;
  act(() => {
    saving = result.current.save(null);
  });
  await waitFor(() => expect(release).toBeDefined());
  act(() => result.current.edit([{ uuid: 'gpu', first: '0', last: '4' }]));
  expect(result.current.raw?.runs[0]?.last).toBe('6');
  await act(async () => {
    release();
    expect(await saving).toBe(true);
  });
  expect(fixture.command.mock.calls.filter(([input]) => input.action === 'edit')).toHaveLength(1);
  expect(result.current.dirty).toBe(false);
});

it('restores a saved configuration as a clean baseline without creating a draft or loading', async () => {
  const configuration = {
    id: 'saved',
    name: 'Laptop',
    revision: 2,
    modelId: 'a'.repeat(64),
    blockCount: 8,
    profileId: 'test',
    load,
    runs: [{ uuid: 'gpu', first: 0, last: 7 }],
  };
  const command = vi.fn<ClusterBridge['command']>().mockResolvedValue({
    ok: true,
    configurations: [configuration],
    configuration,
    draft: null,
    load,
    issues: [],
  });
  const bridge = { command };
  const { result } = renderHook(() => useClusterConfigurations(bridge));
  await act(async () => {
    await result.current.selectConfiguration(configuration);
  });
  expect(result.current.dirty).toBe(false);
  expect(result.current.raw?.runs).toEqual([{ uuid: 'gpu', first: '0', last: '7' }]);
  expect(result.current.raw?.load).toEqual(configuration.load);
  expect(
    command.mock.calls.every(([input]) => input.action === 'list' || input.action === 'read'),
  ).toBe(true);
});

it('keeps failed raw edits visible and never calls a failed write Saved', async () => {
  const command = vi.fn<ClusterBridge['command']>((input) =>
    Promise.resolve(
      input.action === 'edit'
        ? { ok: false, error: 'CONFIGURATION_UNAVAILABLE' }
        : { ok: true, configurations: [], configuration: null, draft: null, load, issues: [] },
    ),
  );
  const bridge = { command };
  const { result } = renderHook(() => useClusterConfigurations(bridge));
  await act(async () => {
    await result.current.selectModel('a'.repeat(64));
  });
  act(() => result.current.edit([{ uuid: 'gpu', first: '-', last: '' }]));
  expect(result.current.error).toBeNull();
  expect(result.current.raw?.runs[0]?.first).toBe('-');
  expect(result.current.dirty).toBe(true);
  expect(result.current.draft).toBe(null);
  await act(async () => {
    await result.current.save('Laptop');
  });
  expect(result.current.error).toBe('CONFIGURATION_UNAVAILABLE');
  expect(command.mock.calls.some(([input]) => input.action === 'save')).toBe(false);
  await act(async () => {
    await result.current.selectModel('b'.repeat(64));
    await result.current.selectModel('a'.repeat(64));
  });
  expect(result.current.raw?.runs[0]?.first).toBe('-');
});
it('retains the editor after updating an existing saved configuration', async () => {
  const configuration = {
    id: 'saved',
    name: 'Laptop',
    revision: 2,
    modelId: 'a'.repeat(64),
    blockCount: 8,
    profileId: 'test',
    load,
    runs: [{ uuid: 'gpu', first: 0, last: 6 }],
  };
  const draft = {
    key: 'config:saved',
    configurationId: 'saved',
    modelId: configuration.modelId,
    revision: 1,
    baseSavedRevision: 2,
    load,
    runs: [{ uuid: 'gpu', first: '0', last: '7' }],
  };
  const command = vi.fn<ClusterBridge['command']>((input) =>
    Promise.resolve({
      ok: true,
      configurations: [configuration],
      configuration,
      draft: input.action === 'read' ? null : draft,
      load,
      issues: [],
    }),
  );
  const bridge = { command };
  const { result } = renderHook(() => useClusterConfigurations(bridge));
  await act(async () => {
    await result.current.selectConfiguration(configuration);
  });
  act(() => result.current.edit([{ uuid: 'gpu', first: '0', last: '7' }]));
  expect(result.current.draft).toBeNull();
  await act(async () => {
    await result.current.save(null);
  });
  expect(result.current.saved?.id).toBe('saved');
  expect(result.current.raw?.runs[0]?.last).toBe('7');
});
