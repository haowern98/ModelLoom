import { expect, it, vi } from 'vitest';
import * as module from './runtime-controller';
const localDevice = {
  name: 'local-pc',
  os: 'Windows',
  cpuName: 'Local CPU',
  threads: 8,
  role: 'Worker' as const,
};
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
    inspect: vi.fn(() => Promise.resolve({ sha256: 'approved', size: '3.80 GB' })),
    expectedHash: 'approved',
    packageId: 'package',
    preflight: vi.fn(() => Promise.resolve()),
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
it('imports an opaque model, rejects forged IDs, and reports readiness only after the host confirms it', async () => {
  const { controller, deps } = setup();
  expect(controller).toBeDefined();
  const imported = await controller.command({ action: 'import' });
  expect(imported.model!.id).toMatch(/^model-/u);
  expect(JSON.stringify(imported)).not.toContain('private/path');
  expect((await controller.command({ action: 'load', modelId: 'model-forged' })).error).toBe(
    'Select the imported Bonsai model.',
  );
  expect(deps.createHost).not.toHaveBeenCalled();
  expect((await controller.command({ action: 'load', modelId: imported.model!.id })).phase).toBe(
    'ready',
  );
  expect((await controller.command({ action: 'stop' })).phase).toBe('stopped');
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
  expect((await controller.command({ action: 'import' })).error).toContain('Bonsai');
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
