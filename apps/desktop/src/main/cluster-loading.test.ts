import { expect, it, vi } from 'vitest';
import { createRuntimeController } from './runtime-controller';
import type {
  ClusterDraft,
  SavedClusterConfiguration,
} from '../../../../packages/core/src/cluster/contracts';
import type { ClusterCommand, ClusterReply } from '../../../../packages/core/src/cluster/wire';
import type { StockClusterReport } from '../../../../packages/core/src/cluster/stock-profile';
import {
  record,
  capabilities,
} from '../../../../packages/core/src/model-configuration/test-fixtures';

const modelId = 'a'.repeat(64);
const uuid = 'GPU-11111111-1111-1111-1111-111111111111';
const configId = '11111111-1111-4111-8111-111111111111';
it('runs an older indexed model configuration without dropping the newly imported model', async () => {
  const { controller, deps, host, initialize, run } = setup();
  try {
    await initialize();
    deps.inspect.mockResolvedValueOnce({
      sha256: 'b'.repeat(64),
      size: '14 GB',
      blockCount: 65,
      contextLimit: 32768,
    });
    await controller.command({ action: 'import' });
    expect((await controller.command({ action: 'snapshot' })).model?.id).toBe(
      `model-${'b'.repeat(64)}`,
    );
    const loaded = await run();
    expect(loaded.error).toBeNull();
    expect(loaded.phase).toBe('ready');
    expect(loaded.model?.id).toBe(`model-${modelId}`);
    expect(loaded.models).toHaveLength(2);
    expect(host.prepareCluster).toHaveBeenCalledWith(
      'E:\\Models\\model.gguf',
      expect.objectContaining({ modelId }),
      expect.anything(),
      false,
      expect.any(Function),
    );
  } finally {
    await controller.quit();
  }
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function setup(popup = false) {
  const events: string[] = [];
  let saved: SavedClusterConfiguration = {
    id: configId,
    name: 'Laptop',
    revision: 1,
    modelId,
    blockCount: 64,
    profileId: 'b11306-four-slot',
    load: {
      defaults: {
        automatic: false,
        contextLength: 7680,
        threads: null,
        evaluationBatch: 2048,
        physicalBatch: 512,
        concurrency: 4,
        flashAttention: true,
      },
      cacheK: 'q8_0',
      cacheV: 'q8_0',
    },
    runs: [{ uuid, first: 0, last: 63 }],
  };
  let draft: ClusterDraft = {
    key: `config:${configId}`,
    configurationId: configId,
    modelId,
    revision: 1,
    baseSavedRevision: 1,
    load: saved.load,
    runs: [{ uuid, first: '0', last: '63' }],
  };
  let phase = 'stopped';
  const reply = (): ClusterReply => ({
    ok: true,
    configurations: [saved],
    configuration: saved,
    draft,
    load: saved.load,
    issues: [],
  });
  const host = {
    configuration: vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        record: record(),
        defaults: record(),
        pendingReload: false,
        maxOutputTokens: capabilities.maxOutputTokens,
        thinkingSupported: false,
      }),
    ),
    command: vi.fn((text: string) => {
      const command = JSON.parse(text) as { action: string };
      events.push(command.action);
      if (command.action === 'load') phase = 'ready';
      if (['stop', 'quit'].includes(command.action)) phase = 'stopped';
      return Promise.resolve({ snapshot: { phase, fault: null } });
    }),
    close: vi.fn(async () => {
      await Promise.resolve();
      events.push('close');
    }),
    prepare: vi.fn(() => Promise.resolve()),
    prepareCluster: vi.fn(async () => {
      await Promise.resolve();
      events.push('prepareCluster');
    }),
    api: vi.fn(async (_caller: string, input: unknown) => {
      await Promise.resolve();
      const action = (input as { action: string }).action;
      if (action === 'readImportSource') return { ok: true as const, source: null };
      if (action === 'readModelUsage') return { ok: true as const, lastUsedAt: null };
      return { ok: true as const, registered: true as const };
    }),
    cluster: vi.fn(async (_caller: string, command: ClusterCommand): Promise<ClusterReply> => {
      await Promise.resolve();
      if (command.action === 'edit') {
        if (command.expectedRevision !== draft.revision)
          return { ok: false, error: 'STALE_CONFIGURATION' };
        draft = { ...draft, ...command.edit, revision: draft.revision + 1 };
      }
      return reply();
    }),
  };
  const deps = {
    enabled: true as const,
    expectedHash: modelId,
    packageId: 'package',
    clusterArtifact: 'b11306-cuda12.4-msvc14.44-dev1',
    pick: vi.fn(() => Promise.resolve('E:\\Models\\model.gguf')),
    inspect: vi.fn(() =>
      Promise.resolve({ sha256: modelId, size: '3.8 GB', blockCount: 64, contextLimit: 32768 }),
    ),
    preflight: vi.fn(() => Promise.resolve()),
    confirmSharedMemory: vi.fn(() => Promise.resolve(false)),
    planCluster: vi.fn((file: string, draft: ClusterDraft, blocks: number, signal: AbortSignal) => {
      void [file, draft, blocks, signal];
      return Promise.resolve([{ uuid, first: 0, last: 63 }]);
    }),
    preflightCluster: vi.fn(
      async (
        _file: string,
        _saved: SavedClusterConfiguration,
        _signal: AbortSignal,
      ): Promise<StockClusterReport> => {
        void [_file, _saved, _signal];
        await Promise.resolve();
        events.push('preflight');
        return {} as StockClusterReport;
      },
    ),
    createHost: vi.fn(() => Promise.resolve(host)),
    createHistoryHost: vi.fn(() => Promise.resolve(host)),
  };
  const { confirmSharedMemory: _unused, ...popupDeps } = deps;
  void _unused;
  const controller = createRuntimeController(popup ? popupDeps : deps);
  const initialize = async (ready = false) => {
    await controller.command({ action: 'snapshot' });
    await controller.command({ action: 'import' });
    if (ready) await controller.command({ action: 'load', modelId: `model-${modelId}` });
    events.length = 0;
    host.command.mockClear();
    host.cluster.mockClear();
  };
  const run = () =>
    controller.command({ action: 'run-configuration', configurationId: configId, revision: 1 });
  return {
    controller,
    deps,
    host,
    get saved() {
      return saved;
    },
    events,
    initialize,
    run,
    changeSaved: (delta: Partial<SavedClusterConfiguration>) => {
      saved = { ...saved, ...delta };
    },
    draft: () => draft,
    changeDraft: (delta: Partial<ClusterDraft>) => {
      draft = { ...draft, ...delta };
    },
  };
}

it('allows deleting saved intent without stopping an already ready model', async () => {
  const f = setup();
  try {
    await f.initialize(true);
    expect((await f.controller.cluster({ action: 'delete', id: configId, revision: 1 })).ok).toBe(
      true,
    );
    expect(f.host.cluster).toHaveBeenCalledWith(expect.any(String), {
      action: 'delete',
      id: configId,
      revision: 1,
    });
    expect(f.host.command).not.toHaveBeenCalled();
    expect((await f.controller.command({ action: 'snapshot' })).phase).toBe('ready');
  } finally {
    await f.controller.quit();
  }
});

it('rejects deletion while an allocation is being admitted for loading', async () => {
  const f = setup();
  const pending = deferred<StockClusterReport>();
  try {
    await f.initialize();
    f.deps.preflightCluster.mockImplementationOnce(() => pending.promise);
    const running = f.run();
    await vi.waitFor(() => expect(f.deps.preflightCluster).toHaveBeenCalledOnce());
    expect(await f.controller.cluster({ action: 'delete', id: configId, revision: 1 })).toEqual({
      ok: false,
      error: 'NOT_READY',
    });
    expect(f.host.cluster.mock.calls.some(([, command]) => command.action === 'delete')).toBe(
      false,
    );
    pending.resolve({} as StockClusterReport);
    await running;
  } finally {
    pending.resolve({} as StockClusterReport);
    await f.controller.quit();
  }
});

it('Auto assign writes raw ranges through owner CAS without saving or loading', async () => {
  const f = setup();
  await f.initialize();
  const result = await f.controller.cluster({
    action: 'auto-place',
    key: f.draft().key,
    revision: 1,
  });
  expect(result.ok).toBe(true);
  expect(f.draft().revision).toBe(2);
  expect(f.draft().runs).toEqual([{ uuid, first: '0', last: '63' }]);
  expect(f.host.cluster.mock.calls.map(([, c]) => c.action)).toEqual(['read', 'edit']);
  expect(f.host.command).not.toHaveBeenCalled();
  await f.controller.quit();
});

it.each(['cancel', 'edit'] as const)('does not apply Auto results after %s', async (action) => {
  const f = setup();
  await f.initialize();
  const pending = deferred<{ uuid: string; first: number; last: number }[]>();
  f.deps.planCluster.mockImplementationOnce(() => pending.promise);
  const auto = f.controller.cluster({ action: 'auto-place', key: f.draft().key, revision: 1 });
  await vi.waitFor(() => expect(f.deps.planCluster).toHaveBeenCalledOnce());
  if (action === 'cancel') await f.controller.cluster({ action: 'cancel-planning' });
  else
    await f.controller.cluster({
      action: 'edit',
      key: f.draft().key,
      expectedRevision: 1,
      edit: { modelId, load: f.saved.load, runs: [{ uuid, first: '-', last: '63' }] },
    });
  expect(f.deps.planCluster.mock.calls[0]![3].aborted).toBe(true);
  pending.resolve([{ uuid, first: 0, last: 63 }]);
  expect(await auto).toEqual({ ok: false, error: 'PLANNING_CANCELLED' });
  expect(f.host.cluster.mock.calls.filter(([, c]) => c.action === 'edit')).toHaveLength(
    action === 'edit' ? 1 : 0,
  );
  await f.controller.quit();
});

it('preflights saved intent before stopping and loads its exact owner ID/revision', async () => {
  const f = setup();
  await f.initialize(true);
  expect((await f.run()).phase).toBe('ready');
  expect(f.events).toEqual(['preflight', 'stop', 'prepareCluster', 'load']);
  expect(f.host.prepareCluster).toHaveBeenCalledWith(
    'E:\\Models\\model.gguf',
    f.saved,
    {},
    false,
    expect.any(Function),
  );
  expect(JSON.parse(f.host.command.mock.calls[1]![0])).toMatchObject({
    action: 'load',
    clusterConfiguration: { id: configId, revision: 1, load: f.saved.load },
  });
  await f.controller.quit();
});

it.each(['NEEDS_RESOURCE_EVIDENCE', 'INSUFFICIENT_RESOURCES'])(
  'preserves a ready model on %s',
  async (code) => {
    const f = setup();
    await f.initialize(true);
    f.deps.preflightCluster.mockRejectedValueOnce(Error(code));
    const result = await f.run();
    expect(result.phase).toBe('ready');
    expect(result.error).toBeTruthy();
    expect(f.host.command).not.toHaveBeenCalled();
    expect(f.host.prepareCluster).not.toHaveBeenCalled();
    await f.controller.quit();
  },
);

it('rejects a dirty draft before admission or stopping the active model', async () => {
  const f = setup();
  await f.initialize(true);
  f.changeDraft({ runs: [{ uuid, first: '-', last: '63' }] });
  expect((await f.run()).error).toBe('The allocation changed. Run the current allocation again.');
  expect(f.deps.preflightCluster).not.toHaveBeenCalled();
  expect(f.host.command).not.toHaveBeenCalled();
  await f.controller.quit();
});

it('rechecks the saved revision after admission and before stopping', async () => {
  const f = setup();
  await f.initialize(true);
  f.deps.preflightCluster.mockImplementationOnce(async () => {
    await Promise.resolve();
    f.changeSaved({ revision: 2 });
    return {} as StockClusterReport;
  });
  expect((await f.run()).error).toBe('The configuration changed. Select it again before running.');
  expect(f.host.command).not.toHaveBeenCalled();
  expect(f.host.prepareCluster).not.toHaveBeenCalled();
  await f.controller.quit();
});

it('reports a failed load when preparing the replacement fails after stopping', async () => {
  const f = setup();
  await f.initialize(true);
  f.host.prepareCluster.mockRejectedValueOnce(Error('PACKAGE_VERIFICATION_FAILED'));
  const result = await f.run();
  expect(result.phase).toBe('failed');
  expect(result.error).toContain('Runtime verification failed');
  expect(
    f.host.command.mock.calls.map(([text]) => (JSON.parse(text) as { action: string }).action),
  ).toEqual(['stop']);
  await f.controller.quit();
});

it.each(['stop', 'quit'] as const)(
  '%s aborts admission and prevents subsequent loading',
  async (action) => {
    const f = setup();
    await f.initialize(true);
    const pending = deferred<StockClusterReport>();
    f.deps.preflightCluster.mockImplementationOnce(() => pending.promise);
    const running = f.run();
    await vi.waitFor(() => expect(f.deps.preflightCluster).toHaveBeenCalledOnce());
    const closing =
      action === 'quit' ? f.controller.quit() : f.controller.command({ action: 'stop' });
    expect(f.deps.preflightCluster.mock.calls[0]![2].aborted).toBe(true);
    pending.resolve({} as StockClusterReport);
    await Promise.all([running, closing]);
    expect(f.host.prepareCluster).not.toHaveBeenCalled();
    expect(
      f.host.command.mock.calls.some(
        ([text]) => (JSON.parse(text) as { action: string }).action === 'load',
      ),
    ).toBe(false);
    if (action === 'quit') expect(f.host.close).toHaveBeenCalledOnce();
    else await f.controller.quit();
  },
);

it('Quit waits for cancelled admission cleanup before confirming completion', async () => {
  const f = setup();
  await f.initialize(true);
  const cleanup = deferred<StockClusterReport>();
  f.deps.preflightCluster.mockImplementationOnce(() => cleanup.promise);
  const running = f.run();
  await vi.waitFor(() => expect(f.deps.preflightCluster).toHaveBeenCalledOnce());
  let finished = false;
  const closing = f.controller.quit().then(() => {
    finished = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(f.deps.preflightCluster.mock.calls[0]![2].aborted).toBe(true);
  expect(finished).toBe(false);
  cleanup.resolve({} as StockClusterReport);
  await Promise.all([running, closing]);
  expect(finished).toBe(true);
});

it('publishes the exact saved configuration and ranges only after ready', async () => {
  const f = setup();
  await f.initialize();
  expect((await f.controller.command({ action: 'snapshot' })).activeCluster).toBeNull();
  const ready = await f.run();
  expect(ready.phase).toBe('ready');
  expect(ready.activeCluster).toEqual({
    configurationId: configId,
    revision: 1,
    runs: f.saved.runs,
  });
  expect((await f.controller.command({ action: 'stop' })).activeCluster).toBeNull();
  await f.controller.quit();
});

it.each(['planner', 'preflight'] as const)(
  'retains %s cleanup failure across future operations and Quit',
  async (source) => {
    const f = setup();
    await f.initialize();
    if (source === 'planner') {
      f.deps.planCluster.mockRejectedValueOnce(Error('CLEANUP_FAILED'));
      expect(
        (await f.controller.cluster({ action: 'auto-place', key: f.draft().key, revision: 1 })).ok,
      ).toBe(false);
    } else {
      f.deps.preflightCluster.mockRejectedValueOnce(Error('CLEANUP_FAILED'));
      expect((await f.run()).error).toContain('Owned runtime exit could not be confirmed');
    }
    const planned = f.deps.planCluster.mock.calls.length;
    const admitted = f.deps.preflightCluster.mock.calls.length;
    expect(
      (await f.controller.cluster({ action: 'auto-place', key: f.draft().key, revision: 1 })).ok,
    ).toBe(false);
    expect((await f.run()).error).toContain('Owned runtime exit could not be confirmed');
    expect(
      (await f.controller.command({ action: 'load', modelId: `model-${modelId}` })).error,
    ).toContain('Owned runtime exit could not be confirmed');
    expect(f.deps.planCluster).toHaveBeenCalledTimes(planned);
    expect(f.deps.preflightCluster).toHaveBeenCalledTimes(admitted);
    expect(f.host.prepareCluster).not.toHaveBeenCalled();
    expect(f.host.prepare).not.toHaveBeenCalled();
    await expect(f.controller.quit()).rejects.toThrow('CLEANUP_FAILED');
    expect(f.host.close).toHaveBeenCalledOnce();
  },
);

it('queues Run behind old Auto cleanup and preserves the ready model when cleanup fails', async () => {
  const f = setup();
  await f.initialize(true);
  const pending = deferred<{ uuid: string; first: number; last: number }[]>();
  f.deps.planCluster.mockImplementationOnce(() =>
    pending.promise.then(() => {
      throw Error('CLEANUP_FAILED');
    }),
  );
  const auto = f.controller.cluster({ action: 'auto-place', key: f.draft().key, revision: 1 });
  await vi.waitFor(() => expect(f.deps.planCluster).toHaveBeenCalledOnce());
  const run = f.run();
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(f.deps.preflightCluster).not.toHaveBeenCalled();
  pending.resolve([]);
  expect((await auto).ok).toBe(false);
  const result = await run;
  expect(result.phase).toBe('ready');
  expect(result.error).toContain('Owned runtime exit could not be confirmed');
  expect(f.deps.preflightCluster).not.toHaveBeenCalled();
  expect(f.host.prepareCluster).not.toHaveBeenCalled();
  expect(f.host.command).not.toHaveBeenCalled();
  await expect(f.controller.quit()).rejects.toThrow('CLEANUP_FAILED');
});

it('does not start another estimate while Run is awaiting admission', async () => {
  const f = setup();
  await f.initialize(true);
  const pending = deferred<StockClusterReport>();
  f.deps.preflightCluster.mockImplementationOnce(() => pending.promise);
  const running = f.run();
  await vi.waitFor(() => expect(f.deps.preflightCluster).toHaveBeenCalledOnce());
  expect(
    await f.controller.cluster({ action: 'auto-place', key: f.draft().key, revision: 1 }),
  ).toEqual({ ok: false, error: 'NOT_READY' });
  expect(f.deps.planCluster).not.toHaveBeenCalled();
  pending.resolve({} as StockClusterReport);
  expect((await running).phase).toBe('ready');
  await f.controller.quit();
});

it('does not restart admission when shared-memory confirmation resolves after Quit', async () => {
  const f = setup();
  await f.initialize(true);
  const confirmation = deferred<boolean>();
  f.deps.preflightCluster.mockRejectedValueOnce(Error('SHARED_GPU_MEMORY_CONFIRMATION'));
  f.deps.confirmSharedMemory.mockImplementationOnce(() => confirmation.promise);
  const running = f.run();
  await vi.waitFor(() => expect(f.deps.confirmSharedMemory).toHaveBeenCalledOnce());
  await f.controller.quit();
  expect(f.host.close).toHaveBeenCalledOnce();
  confirmation.resolve(true);
  await running;
  expect(f.deps.preflightCluster).toHaveBeenCalledOnce();
  expect(f.host.prepareCluster).not.toHaveBeenCalled();
  expect(
    f.host.command.mock.calls.some(
      ([text]) => (JSON.parse(text) as { action: string }).action === 'load',
    ),
  ).toBe(false);
});

it('warns before running a saved configuration and freshly preflights Load anyway', async () => {
  const f = setup(true);
  await f.initialize();
  f.deps.preflightCluster.mockRejectedValueOnce(Error('SHARED_GPU_MEMORY_CONFIRMATION'));
  const running = f.run();
  await vi.waitFor(async () =>
    expect((await f.controller.command({ action: 'snapshot' })).memoryWarning).toBeTruthy(),
  );
  const id = (await f.controller.command({ action: 'snapshot' })).memoryWarning!.id;
  expect(f.host.prepareCluster).not.toHaveBeenCalled();
  await f.controller.command({ action: 'memory-decision', id, loadAnyway: true });
  expect((await running).phase).toBe('ready');
  expect(f.deps.preflightCluster.mock.calls[1]).toEqual([
    expect.any(String),
    f.saved,
    expect.any(AbortSignal),
    true,
  ]);
  expect(f.host.prepareCluster).toHaveBeenCalledOnce();
  await f.controller.quit();
});
it.each(['cancel', 'stop', 'quit'] as const)(
  'clears saved-configuration memory popup on %s without loading',
  async (action) => {
    const f = setup(true);
    await f.initialize();
    f.deps.preflightCluster.mockRejectedValueOnce(Error('SHARED_GPU_MEMORY_CONFIRMATION'));
    const running = f.run();
    await vi.waitFor(async () =>
      expect((await f.controller.command({ action: 'snapshot' })).memoryWarning).toBeTruthy(),
    );
    const id = (await f.controller.command({ action: 'snapshot' })).memoryWarning!.id;
    if (action === 'quit') await f.controller.quit();
    else if (action === 'stop') await f.controller.command({ action: 'stop' });
    else await f.controller.command({ action: 'memory-decision', id, loadAnyway: false });
    await running;
    expect(f.host.prepareCluster).not.toHaveBeenCalled();
    expect(f.deps.preflightCluster).toHaveBeenCalledOnce();
    if (action !== 'quit') await f.controller.quit();
  },
);

it('quietly cancels a shortage first discovered at native creation', async () => {
  const f = setup(true);
  await f.initialize();
  const originalCommand = f.host.command.getMockImplementation()!;
  f.host.command.mockImplementation(async (text) => {
    if ((JSON.parse(text) as { action: string }).action === 'load') {
      const args = f.host.prepareCluster.mock.calls.at(-1)!;
      const confirm: unknown = Reflect.get(args, 4);
      if (typeof confirm !== 'function') throw Error('Missing trusted confirmation');
      expect(await (confirm as () => Promise<boolean>)()).toBe(false);
      return { snapshot: { phase: 'failed', fault: null } };
    }
    return originalCommand(text);
  });
  const running = f.run();
  await vi.waitFor(async () =>
    expect((await f.controller.command({ action: 'snapshot' })).memoryWarning).toBeTruthy(),
  );
  const warning = (await f.controller.command({ action: 'snapshot' })).memoryWarning!;
  await f.controller.command({ action: 'memory-decision', id: warning.id, loadAnyway: false });
  expect(await running).toMatchObject({ phase: 'stopped', error: null, memoryWarning: null });
  const confirm: unknown = Reflect.get(f.host.prepareCluster.mock.calls.at(-1)!, 4);
  await f.controller.command({ action: 'stop' });
  if (typeof confirm !== 'function') throw Error('Missing trusted confirmation');
  expect(await (confirm as () => Promise<boolean>)()).toBe(false);
  await f.controller.quit();
});

it('loads an acknowledged unnamed draft without saving a named configuration', async () => {
  const f = setup();
  try {
    await f.initialize();
    f.changeDraft({ key: `model:${modelId}`, configurationId: null, baseSavedRevision: null });
    const loaded = await f.controller.command({
      action: 'load',
      modelId: `model-${modelId}`,
      draft: { key: `model:${modelId}`, revision: 1 },
    });
    expect(loaded).toMatchObject({
      phase: 'ready',
      error: null,
      activeCluster: { draftKey: `model:${modelId}`, runs: f.saved.runs },
    });
    expect(f.host.cluster.mock.calls.some(([, command]) => command.action === 'save')).toBe(false);
    const load = f.host.command.mock.calls
      .map(([text]) => JSON.parse(text) as Record<string, unknown>)
      .find((command) => command.action === 'load');
    expect(load).toMatchObject({
      modelConfiguration: { name: 'Current allocation', modelId },
      clusterDraft: { key: `model:${modelId}`, revision: 1 },
    });
  } finally {
    await f.controller.quit();
  }
});
it('rejects stale or changed draft intent before native preparation', async () => {
  for (const changedDuringEstimate of [false, true]) {
    const f = setup();
    try {
      await f.initialize();
      f.changeDraft({ key: `model:${modelId}`, configurationId: null, baseSavedRevision: null });
      if (changedDuringEstimate)
        f.deps.preflightCluster.mockImplementationOnce(async () => {
          await Promise.resolve();
          f.changeDraft({ revision: 2 });
          return {} as StockClusterReport;
        });
      const loaded = await f.controller.command({
        action: 'load',
        modelId: `model-${modelId}`,
        draft: { key: `model:${modelId}`, revision: changedDuringEstimate ? 1 : 2 },
      });
      expect(loaded.error).toContain('changed');
      expect(f.host.prepareCluster).not.toHaveBeenCalled();
    } finally {
      await f.controller.quit();
    }
  }
});

it('Stop during the final draft read prevents native preparation', async () => {
  const f = setup();
  try {
    await f.initialize();
    f.changeDraft({ key: `model:${modelId}`, configurationId: null, baseSavedRevision: null });
    const gate = deferred<void>();
    let reads = 0;
    const original = f.host.cluster.getMockImplementation()!;
    f.host.cluster.mockImplementation(async (caller, command) => {
      if (command.action === 'read' && ++reads === 2) await gate.promise;
      return original(caller, command);
    });
    const running = f.controller.command({
      action: 'load',
      modelId: `model-${modelId}`,
      draft: { key: `model:${modelId}`, revision: 1 },
    });
    await vi.waitFor(() => expect(reads).toBe(2));
    await f.controller.command({ action: 'stop' });
    gate.resolve();
    expect((await running).phase).toBe('stopped');
    expect(f.host.prepareCluster).not.toHaveBeenCalled();
  } finally {
    await f.controller.quit();
  }
});

it('refuses a named placement when model settings change during resource admission', async () => {
  const f = setup();
  try {
    await f.initialize();
    f.deps.preflightCluster.mockImplementationOnce(async () => {
      await Promise.resolve();
      const load = { ...f.saved.load, defaults: { ...f.saved.load.defaults, contextLength: 4096 } };
      f.changeSaved({ load });
      f.changeDraft({ load });
      return {} as StockClusterReport;
    });
    expect((await f.run()).error).toContain('changed');
    expect(f.host.prepareCluster).not.toHaveBeenCalled();
  } finally {
    await f.controller.quit();
  }
});
