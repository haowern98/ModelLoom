import { expect, it, vi } from 'vitest';
import * as module from './runtime-controller';
import type { ModelSource } from '../../../../packages/core/src/model-configuration/model-source';
const localDevice = {
  name: 'local-pc',
  os: 'Windows',
  cpuName: 'Local CPU',
  threads: 8,
  role: 'Worker' as const,
};
it('keeps an active model ready when an unevidenced saved configuration is rejected', async () => {
  const { controller, host } = setup();
  await controller.command({ action: 'import' });
  const imported = await controller.command({ action: 'snapshot' });
  if (!imported.model) throw Error('fixture model unavailable');
  expect((await controller.command({ action: 'load', modelId: imported.model.id })).phase).toBe(
    'ready',
  );
  const attempts = host.command.mock.calls.length;
  const rejected = await controller.command({
    action: 'run-configuration',
    configurationId: '12345678-1234-4234-8234-123456789abc',
    revision: 1,
  });
  expect(rejected.phase).toBe('ready');
  expect(rejected.error).toContain('verified for the selected runtime and GPUs');
  expect(host.command).toHaveBeenCalledTimes(attempts);
  await controller.quit();
});
function setup(enabled = true) {
  let phase = 'stopped';
  const host = {
    command: vi.fn((text: string) => {
      const value: unknown = JSON.parse(text);
      if (!value || typeof value !== 'object' || !('action' in value))
        throw new Error('INVALID_CONTROL');
      if (value.action === 'load') phase = 'ready';
      if (value.action === 'stop' || value.action === 'quit') phase = 'stopped';
      return Promise.resolve({ snapshot: { phase, fault: null } });
    }),
    close: vi.fn(() => Promise.resolve()),
  };
  const deps = {
    enabled,
    pick: vi.fn(() => Promise.resolve('private/path.gguf')),
    inspect: vi.fn(() => Promise.resolve({ sha256: 'a'.repeat(64), size: '3.80 GB' })),
    expectedHash: 'a'.repeat(64),
    packageId: 'package',
    preflight: vi.fn(() => Promise.resolve()),
    confirmSharedMemory: vi.fn(() => Promise.resolve(false)),
    createHost: vi.fn(() => Promise.resolve(host)),
    device: vi.fn(() => Promise.resolve(localDevice)),
  };
  const controller = Reflect.get(module, 'createRuntimeController')?.(deps);
  return { controller, host, deps };
}
it('shows this device before import or load, independently of role and runtime activation', async () => {
  const { controller, deps } = setup(false);
  const snapshot = await controller.command({ action: 'snapshot' });
  expect(snapshot.device).toEqual(localDevice);
  expect(snapshot.model).toBeNull();
  expect(snapshot.phase).toBe('stopped');
  expect(snapshot.enabled).toBe(false);
  expect(await controller.command({ action: 'snapshot' })).toEqual(snapshot);
  expect(deps.device).toHaveBeenCalledTimes(1);
  expect(deps.pick).not.toHaveBeenCalled();
  expect(deps.inspect).not.toHaveBeenCalled();
  expect(deps.preflight).not.toHaveBeenCalled();
  expect(deps.createHost).not.toHaveBeenCalled();
});
it('retries unavailable device information without reporting a model failure', async () => {
  const { controller, deps } = setup();
  deps.device.mockRejectedValueOnce(new Error('DEVICE_QUERY_FAILED'));
  const initial = await controller.command({ action: 'snapshot' });
  expect(initial.phase).toBe('stopped');
  expect(initial.error).toBeNull();
  expect(initial.device).toBeUndefined();
  expect((await controller.command({ action: 'snapshot' })).device).toEqual(localDevice);
  expect(deps.createHost).not.toHaveBeenCalled();
});
it('refreshes expired memory observations without starting a model', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(10000);
  try {
    const { controller, deps } = setup(false);
    await controller.command({ action: 'snapshot' });
    clock.mockReturnValue(20001);
    deps.device.mockResolvedValueOnce({ ...localDevice, name: 'updated-host' });
    expect((await controller.command({ action: 'snapshot' })).device?.name).toBe('updated-host');
    expect(deps.device).toHaveBeenCalledTimes(2);
    expect(deps.createHost).not.toHaveBeenCalled();
  } finally {
    clock.mockRestore();
  }
});

it('waits for an in-flight hardware query on Quit without starting an engine', async () => {
  const { controller, deps } = setup(false);
  let release!: (device: typeof localDevice) => void;
  deps.device.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const observing = controller.command({ action: 'snapshot' });
  await vi.waitFor(() => expect(deps.device).toHaveBeenCalledTimes(1));
  let closed = false;
  const closing = controller.quit().then(() => {
    closed = true;
  });
  await Promise.resolve();
  expect(closed).toBe(false);
  release(localDevice);
  await Promise.all([observing, closing]);
  expect(closed).toBe(true);
  expect(deps.createHost).not.toHaveBeenCalled();
});

it('refreshes immediately after a device-change notification despite the ten-second cache', async () => {
  const { controller, deps } = setup(false);
  await controller.command({ action: 'snapshot' });
  deps.device.mockResolvedValueOnce({ ...localDevice, name: 'GPU-disabled' });
  await controller.deviceChanged();
  expect((await controller.command({ action: 'snapshot' })).device?.name).toBe('GPU-disabled');
  expect(deps.device).toHaveBeenCalledTimes(2);
  expect(deps.createHost).not.toHaveBeenCalled();
  await controller.quit();
  await controller.deviceChanged();
  expect(deps.device).toHaveBeenCalledTimes(2);
});

it('discards a stale hardware scan and coalesces changes during it into one fresh scan', async () => {
  const { controller, deps } = setup(false);
  let release!: (device: typeof localDevice) => void;
  deps.device.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const before = controller.command({ action: 'snapshot' });
  await vi.waitFor(() => expect(deps.device).toHaveBeenCalledTimes(1));
  deps.device.mockResolvedValueOnce({ ...localDevice, name: 'new-hardware' });
  const firstChange = controller.deviceChanged();
  const secondChange = controller.deviceChanged();
  expect(deps.device).toHaveBeenCalledTimes(1);
  release(localDevice);
  await Promise.all([before, firstChange, secondChange]);
  expect((await controller.command({ action: 'snapshot' })).device?.name).toBe('new-hardware');
  expect(deps.device).toHaveBeenCalledTimes(2);
  await controller.quit();
});

it('does not confirm Quit if diagnostic child cleanup could not be confirmed', async () => {
  const { controller, deps } = setup(false);
  deps.device.mockRejectedValueOnce(new Error('QUERY_CLEANUP_FAILED'));
  await expect(controller.command({ action: 'snapshot' })).rejects.toThrow('QUERY_CLEANUP_FAILED');
  await expect(controller.quit()).rejects.toThrow('QUERY_CLEANUP_FAILED');
});
it('imports an opaque model, rejects forged IDs, and reports readiness only after the host confirms it', async () => {
  const { controller, deps } = setup();
  expect(controller).toBeDefined();
  const imported = await controller.command({ action: 'import' });
  expect(imported.model!.id).toMatch(/^model-/u);
  expect(JSON.stringify(imported)).not.toContain('private/path');
  expect((await controller.command({ action: 'load', modelId: 'model-forged' })).error).toBe(
    'Select the imported model.',
  );
  expect(deps.createHost).not.toHaveBeenCalled();
  expect((await controller.command({ action: 'load', modelId: imported.model!.id })).phase).toBe(
    'ready',
  );
  expect((await controller.command({ action: 'stop' })).phase).toBe('stopped');
  await controller.quit();
});

it('indexes a different valid model hash and restores its source through the correct unloaded owner', async () => {
  const modelId = 'b'.repeat(64);
  let source: ModelSource | null = null;
  let lastUsedAt: number | null = null;
  let release!: (info: { sha256: string; size: string }) => void;
  const host = {
    command: vi.fn(() => Promise.resolve({ snapshot: { phase: 'stopped' } })),
    close: vi.fn(() => Promise.resolve()),
    api: vi.fn((_caller: string, input: unknown) => {
      const command = input as { action: string; source?: typeof source };
      if (command.action === 'readModelUsage')
        return Promise.resolve({ ok: true as const, lastUsedAt });
      if (command.action === 'readImportSource')
        return Promise.resolve({ ok: true as const, source });
      if (command.action === 'readLibraryEntry')
        return Promise.resolve({
          ok: true as const,
          entry:
            source && !(input as { after: string | null }).after ? { source, lastUsedAt } : null,
        });
      source = command.source ?? null;
      return Promise.resolve({ ok: true as const, registered: true as const });
    }),
  };
  const deps = {
    enabled: true as const,
    expectedHash: 'a'.repeat(64),
    packageId: 'package',
    pick: vi.fn(() => Promise.resolve('E:\\Models\\filename.gguf')),
    inspect: vi.fn(
      () =>
        new Promise<{ sha256: string; size: string }>((resolve) => {
          release = resolve;
        }),
    ),
    preflight: vi.fn(),
    createHost: vi.fn(),
    createHistoryHost: vi.fn(() => Promise.resolve(host)),
    available: vi.fn(() => Promise.resolve(true)),
  };
  const controller = module.createRuntimeController(deps, 'window');
  const importing = controller.command({ action: 'import' });
  await vi.waitFor(() => expect(deps.inspect).toHaveBeenCalledTimes(1));
  const pending = await controller.command({ action: 'snapshot' });
  expect(pending.indexing).toBe('filename.gguf');
  expect(JSON.stringify(pending)).not.toContain('E:\\Models');
  release({ sha256: modelId, size: '4 GB' });
  const imported = await importing;
  expect(imported.model?.name).toBe('filename.gguf');
  expect(deps.createHistoryHost).toHaveBeenCalledWith(
    expect.objectContaining({ modelId, file: 'E:\\Models\\filename.gguf' }),
  );
  expect(imported.model?.lastUsedAt).toBeUndefined();
  lastUsedAt = Date.now();
  const used = await controller.command({ action: 'snapshot' });
  expect(used.model?.lastUsedAt).toBe(lastUsedAt);
  expect(used.models?.[0]?.lastUsedAt).toBe(lastUsedAt);
  expect(source).not.toBeNull();
  await controller.quit();
  const reopened = module.createRuntimeController(deps, 'window');
  await vi.waitFor(async () =>
    expect((await reopened.command({ action: 'snapshot' })).restoring).toBe(false),
  );
  const restored = await reopened.command({ action: 'snapshot' });
  expect(restored.model?.id).toBe(`model-${modelId}`);
  expect(deps.createHistoryHost).toHaveBeenLastCalledWith(expect.objectContaining({ modelId }));
  expect(restored.phase).toBe('stopped');
  expect(restored.model?.unavailable).toBe(false);
  expect(restored.model?.lastUsedAt).toBe(lastUsedAt);
  expect(deps.inspect).toHaveBeenCalledTimes(1);
  expect(deps.preflight).not.toHaveBeenCalled();
  expect(deps.createHost).not.toHaveBeenCalled();
  expect(JSON.stringify(restored)).not.toContain('E:\\Models');
  await reopened.quit();
  deps.available.mockResolvedValueOnce(false);
  const missing = module.createRuntimeController(deps, 'window');
  await vi.waitFor(async () =>
    expect((await missing.command({ action: 'snapshot' })).restoring).toBe(false),
  );
  expect((await missing.command({ action: 'snapshot' })).model?.unavailable).toBe(true);
  await missing.quit();
});

it('rechecks imported content before loading instead of trusting cached identity', async () => {
  const { controller, deps } = setup();
  const imported = await controller.command({ action: 'import' });
  deps.inspect.mockResolvedValueOnce({ sha256: 'changed', size: '3.80 GB' });
  const result = await controller.command({ action: 'load', modelId: imported.model!.id });
  expect(result.phase).toBe('failed');
  expect(result.model?.unavailable).toBe(true);
  expect(result.models?.[0]?.id).toBe(imported.model!.id);
  expect(deps.preflight).not.toHaveBeenCalled();
  expect(deps.createHost).not.toHaveBeenCalled();
  await controller.quit();
});

it('blocks loading an old library entry while a replacement import is indexing', async () => {
  const { controller, deps } = setup();
  const initial = await controller.command({ action: 'import' });
  let release!: (info: { sha256: string; size: string }) => void;
  deps.inspect.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const importing = controller.command({ action: 'import' });
  await vi.waitFor(() => expect(deps.inspect).toHaveBeenCalledTimes(2));
  const loading = await controller.command({ action: 'load', modelId: initial.model!.id });
  expect(loading.error).toContain('Stop the current model');
  expect(loading.phase).toBe('stopped');
  expect(deps.createHost).not.toHaveBeenCalled();
  release({ sha256: 'a'.repeat(64), size: '3.80 GB' });
  expect((await importing).phase).toBe('stopped');
  await controller.quit();
});

it('waits for indexing cleanup on Quit and never publishes its unfinished import', async () => {
  const { controller, deps } = setup();
  let release!: (info: { sha256: string; size: string }) => void;
  deps.inspect.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const importing = controller.command({ action: 'import' });
  await vi.waitFor(() => expect(deps.inspect).toHaveBeenCalledTimes(1));
  let closed = false;
  const closing = controller.quit().then(() => {
    closed = true;
  });
  await Promise.resolve();
  expect(closed).toBe(false);
  release({ sha256: 'a'.repeat(64), size: '3.80 GB' });
  await Promise.all([importing, closing]);
  expect((await controller.command({ action: 'snapshot' })).model).toBeNull();
  expect(deps.createHost).not.toHaveBeenCalled();
});

it('can quit before file selection without waiting for the picker or starting inspection', async () => {
  const { controller, deps } = setup();
  let choose!: (file: string) => void;
  deps.pick.mockImplementationOnce(
    () =>
      new Promise<string>((resolve) => {
        choose = resolve;
      }),
  );
  const importing = controller.command({ action: 'import' });
  await vi.waitFor(() => expect(deps.pick).toHaveBeenCalled());
  let closed = false;
  const closing = controller.quit().then(() => {
    closed = true;
  });
  try {
    await vi.waitFor(() => expect(closed).toBe(true));
  } finally {
    choose('private/path.gguf');
    await Promise.all([importing, closing]);
  }
  expect(deps.inspect).not.toHaveBeenCalled();
});

it('does not let a cancelled load inspection invalidate a newer imported entry', async () => {
  const { controller, deps } = setup();
  const initial = await controller.command({ action: 'import' });
  let reject!: (error: Error) => void;
  deps.inspect.mockImplementationOnce(
    () =>
      new Promise((_resolve, rejectInspection) => {
        reject = rejectInspection;
      }),
  );
  const loading = controller.command({ action: 'load', modelId: initial.model!.id });
  await vi.waitFor(() => expect(deps.inspect).toHaveBeenCalledTimes(2));
  await controller.command({ action: 'stop' });
  await controller.command({ action: 'import' });
  reject(new Error('OLD_FILE_UNAVAILABLE'));
  const result = await loading;
  expect(result.phase).toBe('stopped');
  expect(result.model?.unavailable).toBe(false);
  expect(deps.createHost).not.toHaveBeenCalled();
  await controller.quit();
});
it('keeps resource rejection honest, launches nothing, and allows an explicit retry', async () => {
  const { controller, deps } = setup();
  expect(controller).toBeDefined();
  const view = await controller.command({ action: 'import' });
  deps.preflight.mockRejectedValueOnce(new Error('INSUFFICIENT_RESOURCES'));
  const failed = await controller.command({ action: 'load', modelId: view.model!.id });
  expect(failed.phase).toBe('failed');
  expect(failed.error).toContain('RAM or GPU memory');
  expect(deps.createHost).not.toHaveBeenCalled();
  expect((await controller.command({ action: 'load', modelId: view.model!.id })).phase).toBe(
    'ready',
  );
  await controller.quit();
});
it('denies paths and mismatched GGUFs without forwarding them to a host', async () => {
  const { controller, deps } = setup();
  expect(controller).toBeDefined();
  await expect(controller.command({ action: 'import', path: 'anything' })).rejects.toThrow(
    'INVALID_CONTROL',
  );
  expect(deps.pick).not.toHaveBeenCalled();
  deps.inspect.mockResolvedValueOnce({ sha256: 'different', size: '1 GB' });
  expect((await controller.command({ action: 'import' })).error).toBeTruthy();
  expect(deps.createHost).not.toHaveBeenCalled();
});
it('explains rejected model file ownership without disclosing its path or starting an engine', async () => {
  const { controller, deps } = setup();
  deps.inspect.mockRejectedValueOnce(new Error('OWNERSHIP_FAILED'));

  const rejected = await controller.command({ action: 'import' });

  expect(rejected.phase).toBe('failed');
  expect(rejected.model).toBeNull();
  expect(rejected.error).toContain('standalone copy');
  expect(JSON.stringify(rejected)).not.toContain('private/path');
  expect(deps.preflight).not.toHaveBeenCalled();
  expect(deps.createHost).not.toHaveBeenCalled();
});
it('keeps a rejected retry visible even when an existing core is stopped', async () => {
  const { controller, deps } = setup();
  const imported = await controller.command({ action: 'import' });
  await controller.command({ action: 'load', modelId: imported.model!.id });
  await controller.command({ action: 'stop' });
  deps.preflight.mockRejectedValueOnce(new Error('INSUFFICIENT_RESOURCES'));
  const failed = await controller.command({ action: 'load', modelId: imported.model!.id });
  expect(await controller.command({ action: 'snapshot' })).toEqual(failed);
  await controller.quit();
});
it('cancels shared-memory loading before host creation when the warning is declined', async () => {
  const { controller, deps } = setup();
  const imported = await controller.command({ action: 'import' });
  deps.preflight.mockRejectedValueOnce(new Error('SHARED_GPU_MEMORY_CONFIRMATION'));
  const result = await controller.command({ action: 'load', modelId: imported.model!.id });
  expect(deps.confirmSharedMemory).toHaveBeenCalledTimes(1);
  expect(result.phase).toBe('stopped');
  expect(result.error).toBeNull();
  expect(deps.createHost).not.toHaveBeenCalled();
});
it('rechecks resources after shared-memory confirmation before starting the model', async () => {
  const { controller, deps, host } = setup();
  const imported = await controller.command({ action: 'import' });
  deps.confirmSharedMemory.mockResolvedValueOnce(true);
  deps.preflight.mockRejectedValueOnce(new Error('SHARED_GPU_MEMORY_CONFIRMATION'));
  const result = await controller.command({ action: 'load', modelId: imported.model!.id });
  expect(result.phase).toBe('ready');
  expect(deps.preflight).toHaveBeenNthCalledWith(2, true);
  expect(host.command.mock.calls.some(([text]) => text.includes('"action":"load"'))).toBe(true);
  await controller.quit();
});
it('does not reuse a pending confirmation after Stop or bypass a fresh RAM shortage', async () => {
  const { controller, deps } = setup();
  const imported = await controller.command({ action: 'import' });
  deps.preflight.mockRejectedValueOnce(new Error('SHARED_GPU_MEMORY_CONFIRMATION'));
  let confirm!: (value: boolean) => void;
  deps.confirmSharedMemory.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        confirm = resolve;
      }),
  );
  const loading = controller.command({ action: 'load', modelId: imported.model!.id });
  await vi.waitFor(() => expect(deps.confirmSharedMemory).toHaveBeenCalledTimes(1));
  await controller.command({ action: 'stop' });
  confirm(true);
  expect((await loading).phase).toBe('stopped');
  expect(deps.createHost).not.toHaveBeenCalled();
  deps.preflight.mockRejectedValueOnce(new Error('SHARED_GPU_MEMORY_CONFIRMATION'));
  deps.preflight.mockRejectedValueOnce(new Error('INSUFFICIENT_RESOURCES'));
  deps.confirmSharedMemory.mockResolvedValueOnce(true);
  expect(
    (await controller.command({ action: 'load', modelId: imported.model!.id })).error,
  ).toContain('Not enough');
  expect(deps.createHost).not.toHaveBeenCalled();
});
it('preserves real readiness after rejecting a duplicate command', async () => {
  const { controller, host } = setup();
  const imported = await controller.command({ action: 'import' });
  await controller.command({ action: 'load', modelId: imported.model!.id });
  const duplicate = await controller.command({ action: 'load', modelId: imported.model!.id });
  expect(duplicate.phase).toBe('ready');
  expect(duplicate.error).toContain('Stop the current model');
  expect(host.command.mock.calls.filter(([text]) => text.includes('"action":"load"'))).toHaveLength(
    1,
  );
  await controller.quit();
});
it('waits for preparation on Quit and never loads after admission closes', async () => {
  const { controller, host, deps } = setup();
  let release!: (value: typeof host) => void;
  deps.createHost.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const imported = await controller.command({ action: 'import' });
  const loading = controller.command({ action: 'load', modelId: imported.model!.id });
  await vi.waitFor(() => expect(deps.createHost).toHaveBeenCalled());
  let closed = false;
  const closing = controller.quit().then(() => {
    closed = true;
  });
  await Promise.resolve();
  expect(closed).toBe(false);
  release(host);
  await Promise.all([loading, closing]);
  expect(host.command.mock.calls.some(([text]) => text.includes('"action":"load"'))).toBe(false);
  expect(host.close).toHaveBeenCalledTimes(1);
  expect((await controller.command({ action: 'snapshot' })).phase).toBe('stopped');
});

it('joins owner confirmation before Quit completes when the core has exited', async () => {
  const { controller, host } = setup();
  const imported = await controller.command({ action: 'import' });
  await controller.command({ action: 'load', modelId: imported.model!.id });
  host.command.mockRejectedValueOnce(new Error('CORE_EXITED'));
  let confirm!: () => void;
  host.close.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        confirm = resolve;
      }),
  );
  let settled = false;
  const outcome = controller.quit().then(
    () => {
      settled = true;
    },
    (error: unknown) => error,
  );
  await vi.waitFor(() => expect(host.close).toHaveBeenCalledTimes(1));
  expect(settled).toBe(false);
  confirm();
  await expect(outcome).resolves.toBeUndefined();
  expect(settled).toBe(true);
});

it('rejects Quit after core exit when owner cleanup cannot be confirmed', async () => {
  const { controller, host } = setup();
  const imported = await controller.command({ action: 'import' });
  await controller.command({ action: 'load', modelId: imported.model!.id });
  host.command.mockRejectedValueOnce(new Error('CORE_EXITED'));
  host.close.mockRejectedValueOnce(new Error('CLEANUP_FAILED'));
  await expect(controller.quit()).rejects.toThrow('CLEANUP_FAILED');
});

it('does not turn other broker failures into successful Quit', async () => {
  const { controller, host } = setup();
  const imported = await controller.command({ action: 'import' });
  await controller.command({ action: 'load', modelId: imported.model!.id });
  host.command.mockRejectedValueOnce(new Error('INVALID_CONTROL'));
  await expect(controller.quit()).rejects.toThrow('INVALID_CONTROL');
  expect(host.close).not.toHaveBeenCalled();
});

function popupSetup() {
  const fixture = setup();
  const { confirmSharedMemory: _unused, ...deps } = fixture.deps;
  void _unused;
  return { ...fixture, controller: module.createRuntimeController(deps) };
}
async function pendingMemoryWarning(f: ReturnType<typeof popupSetup>) {
  const imported = await f.controller.command({ action: 'import' });
  f.deps.preflight.mockRejectedValueOnce(Error('SHARED_GPU_MEMORY_CONFIRMATION'));
  const loading = f.controller.command({ action: 'load', modelId: imported.model!.id });
  let warningId = '';
  await vi.waitFor(async () => {
    const warning = (await f.controller.command({ action: 'snapshot' })).memoryWarning;
    expect(warning).toBeTruthy();
    warningId = warning!.id;
  });
  return { loading, warningId, modelId: imported.model!.id };
}
it('ignores mismatched popup decisions and cancels without preparing an engine', async () => {
  const f = popupSetup();
  const pending = await pendingMemoryWarning(f);
  await f.controller.command({
    action: 'memory-decision',
    id: '22222222-2222-4222-8222-222222222222',
    loadAnyway: true,
  });
  expect((await f.controller.command({ action: 'snapshot' })).memoryWarning?.id).toBe(
    pending.warningId,
  );
  expect(f.deps.createHost).not.toHaveBeenCalled();
  await f.controller.command({
    action: 'memory-decision',
    id: pending.warningId,
    loadAnyway: false,
  });
  expect((await pending.loading).phase).toBe('stopped');
  expect(f.deps.createHost).not.toHaveBeenCalled();
  await f.controller.quit();
});
it('requires fresh popup permission and reruns preflight for Load anyway', async () => {
  const f = popupSetup();
  const pending = await pendingMemoryWarning(f);
  await f.controller.command({
    action: 'memory-decision',
    id: pending.warningId,
    loadAnyway: true,
  });
  expect((await pending.loading).phase).toBe('ready');
  expect(f.deps.preflight).toHaveBeenNthCalledWith(2, true);
  await f.controller.command({ action: 'stop' });
  f.deps.preflight.mockRejectedValueOnce(Error('SHARED_GPU_MEMORY_CONFIRMATION'));
  const second = f.controller.command({ action: 'load', modelId: pending.modelId });
  await vi.waitFor(async () =>
    expect((await f.controller.command({ action: 'snapshot' })).memoryWarning).toBeTruthy(),
  );
  const newId = (await f.controller.command({ action: 'snapshot' })).memoryWarning!.id;
  expect(newId).not.toBe(pending.warningId);
  await f.controller.command({
    action: 'memory-decision',
    id: pending.warningId,
    loadAnyway: true,
  });
  expect((await f.controller.command({ action: 'snapshot' })).memoryWarning?.id).toBe(newId);
  await f.controller.command({ action: 'memory-decision', id: newId, loadAnyway: false });
  await second;
  await f.controller.quit();
});
it.each(['stop', 'quit'] as const)(
  'cancels pending memory popup on %s without renderer response',
  async (action) => {
    const f = popupSetup();
    const pending = await pendingMemoryWarning(f);
    if (action === 'quit') await f.controller.quit();
    else await f.controller.command({ action: 'stop' });
    await pending.loading;
    expect(f.deps.createHost).not.toHaveBeenCalled();
    if (action !== 'quit') await f.controller.quit();
  },
);
