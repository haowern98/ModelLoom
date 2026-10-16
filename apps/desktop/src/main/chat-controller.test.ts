import { expect, it, vi } from 'vitest';
import path from 'node:path';
import { createRuntimeController } from './runtime-controller';
it('binds Chat to main caller and rejects new work after Quit', async () => {
  const callers: string[] = [];
  const controller = createRuntimeController(
    {
      enabled: true,
      expectedHash: 'a'.repeat(64),
      packageId: 'package',
      pick: () => Promise.resolve('private.gguf'),
      inspect: () => Promise.resolve({ sha256: 'a'.repeat(64), size: '1 GB' }),
      preflight: () => Promise.resolve(),
      createHost: () =>
        Promise.resolve({
          command: () => Promise.resolve({ snapshot: { phase: 'ready', fault: null } }),
          close: () => Promise.resolve(),
          chat: (caller: string) => {
            callers.push(caller);
            return Promise.resolve({ ok: true });
          },
        }),
    },
    'main-window',
  );
  expect(await controller.chat({ action: 'newConversation' })).toEqual({
    ok: false,
    error: 'NOT_READY',
  });
  const imported = await controller.command({ action: 'import' });
  await controller.command({ action: 'load', modelId: imported.model!.id });
  expect(await controller.chat({ action: 'newConversation' })).toEqual({ ok: true });
  expect(callers).toEqual(['main-window']);
  await expect(
    controller.chat({ action: 'cancel', requestId: 'r', callerId: 'forged' }),
  ).rejects.toThrow('INVALID_CONTROL');
  await controller.quit();
  expect(await controller.chat({ action: 'newConversation' })).toEqual({
    ok: false,
    error: 'NOT_READY',
  });
  expect(callers).toEqual(['main-window']);
});

function startup() {
  let phase = 'stopped';
  const host = {
    command: vi.fn((text: string) => {
      const value: unknown = JSON.parse(text);
      if (!value || typeof value !== 'object' || !('action' in value))
        throw new Error('INVALID_CONTROL');
      const action = value.action;
      phase = action === 'load' ? 'ready' : action === 'snapshot' ? phase : 'stopped';
      return Promise.resolve({ snapshot: { phase, fault: null } });
    }),
    prepare: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
    chat: vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        page: { payload: 'saved chat', next: null, revision: 0 },
      }),
    ),
  };
  const deps = {
    enabled: true as const,
    expectedHash: 'a'.repeat(64),
    packageId: 'package',
    pick: vi.fn(() => Promise.resolve('private.gguf')),
    inspect: vi.fn(() => Promise.resolve({ sha256: 'a'.repeat(64), size: '1 GB' })),
    preflight: vi.fn(() => Promise.resolve()),
    createHost: vi.fn(() => Promise.reject(new Error('UNEXPECTED_MODEL_HOST'))),
    createHistoryHost: vi.fn(() => Promise.resolve(host)),
  };
  return { host, deps };
}

it('opens saved history before model import or resource admission, keeping Send closed', async () => {
  const { host, deps } = startup();
  const controller = createRuntimeController(deps, 'main-window');
  const saved = await controller.chat({ action: 'list' });
  expect(saved.page?.payload).toBe('saved chat');
  expect((await controller.command({ action: 'snapshot' })).phase).toBe('stopped');
  expect(deps.pick).not.toHaveBeenCalled();
  expect(deps.preflight).not.toHaveBeenCalled();
  expect(host.prepare).not.toHaveBeenCalled();
  expect(await controller.chat({ action: 'send', conversationId: 'c', text: 'hello' })).toEqual({
    ok: false,
    error: 'NOT_READY',
  });
  expect(host.chat).toHaveBeenCalledTimes(1);
  await controller.quit();
});

it('keeps one history owner through imports and rejected model loads', async () => {
  const { host, deps } = startup();
  const controller = createRuntimeController(deps);
  await controller.chat({ action: 'list' });
  const imported = await controller.command({ action: 'import' });
  deps.preflight.mockRejectedValueOnce(new Error('INSUFFICIENT_RESOURCES'));
  expect((await controller.command({ action: 'load', modelId: imported.model!.id })).phase).toBe(
    'failed',
  );
  expect((await controller.chat({ action: 'list' })).page?.payload).toBe('saved chat');
  expect(host.prepare).not.toHaveBeenCalled();
  expect((await controller.command({ action: 'load', modelId: imported.model!.id })).phase).toBe(
    'ready',
  );
  expect(host.prepare).toHaveBeenCalledWith(path.resolve('private.gguf'));
  await controller.command({ action: 'stop' });
  await controller.command({ action: 'import' });
  expect((await controller.chat({ action: 'list' })).page?.payload).toBe('saved chat');
  expect(deps.createHistoryHost).toHaveBeenCalledTimes(1);
  expect(host.close).not.toHaveBeenCalled();
  await controller.quit();
  expect(host.close).toHaveBeenCalledTimes(1);
});

it('waits for startup history on Quit and never forwards pending Chat after admission closes', async () => {
  const { host, deps } = startup();
  let release!: (value: typeof host) => void;
  deps.createHistoryHost.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const controller = createRuntimeController(deps);
  const pending = controller.chat({ action: 'list' });
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  let closed = false;
  const quitting = controller.quit().then(() => {
    closed = true;
  });
  await Promise.resolve();
  expect(closed).toBe(false);
  release(host);
  expect(await pending).toEqual({ ok: false, error: 'NOT_READY' });
  await quitting;
  expect(host.chat).not.toHaveBeenCalled();
  expect(host.close).toHaveBeenCalledTimes(1);
});

it('reports a startup storage failure without attempting a runtime or leaking its error', async () => {
  const { deps } = startup();
  deps.createHistoryHost.mockRejectedValueOnce(new Error('private/path credential'));
  const controller = createRuntimeController(deps);
  expect(await controller.chat({ action: 'list' })).toEqual({
    ok: false,
    error: 'HISTORY_UNAVAILABLE',
  });
  expect(deps.preflight).not.toHaveBeenCalled();
  await controller.quit();
});

it('waits for deferred engine preparation on Quit without loading or losing the history owner', async () => {
  const { host, deps } = startup();
  let release!: () => void;
  host.prepare.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const controller = createRuntimeController(deps);
  const imported = await controller.command({ action: 'import' });
  const loading = controller.command({ action: 'load', modelId: imported.model!.id });
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  let closed = false;
  const quitting = controller.quit().then(() => {
    closed = true;
  });
  await Promise.resolve();
  expect(closed).toBe(false);
  release();
  await Promise.all([loading, quitting]);
  expect(host.command.mock.calls.some(([text]) => text.includes('"action":"load"'))).toBe(false);
  expect(host.close).toHaveBeenCalledTimes(1);
});
