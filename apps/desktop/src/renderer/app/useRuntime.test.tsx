import { afterEach, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import * as module from './useRuntime';
import type { RuntimeCommand, RuntimeView } from '../../shared/runtime';
afterEach(() => {
  delete window.modelLoomRuntime;
});
it('imports through the bridge and waits for actual readiness, without a demo completion timer', async () => {
  let release!: (value: RuntimeView) => void;
  const model = { id: 'model-123', name: 'Bonsai 27B', size: '3.80 GB' };
  const command = vi.fn(async (input: RuntimeCommand): Promise<RuntimeView> =>
    input.action === 'load'
      ? await new Promise<RuntimeView>((resolve) => {
          release = resolve;
        })
      : {
          enabled: true,
          phase: 'stopped',
          model: input.action === 'import' ? model : null,
          error: null,
        },
  );
  window.modelLoomRuntime = { command };
  const useRuntime = Reflect.get(module, 'useRuntime');
  expect(useRuntime).toBeDefined();
  const hook = renderHook(() => useRuntime());
  await waitFor(() => expect(hook.result.current.view?.enabled).toBe(true));
  await act(() => hook.result.current.run({ action: 'import' }));
  expect(hook.result.current.view!.model).toEqual(model);
  let load!: Promise<void>;
  act(() => {
    load = hook.result.current.run({ action: 'load', modelId: model.id });
  });
  expect(hook.result.current.loading).toBe(true);
  expect(hook.result.current.view!.phase).not.toBe('ready');
  await act(async () => {
    release({ enabled: true, phase: 'ready', model, error: null });
    await load;
  });
  expect(hook.result.current.view!.phase).toBe('ready');
  hook.unmount();
});
it('polls memory warnings during a pending load without replacing its final result', async () => {
  const base: RuntimeView = { enabled: true, phase: 'stopped', model: null, error: null };
  let snapshot = base;
  let finishLoad!: (view: RuntimeView) => void;
  let finishAnswer!: (view: RuntimeView) => void;
  const command = vi.fn((input: RuntimeCommand) => {
    if (input.action === 'load')
      return new Promise<RuntimeView>((resolve) => {
        finishLoad = resolve;
      });
    if (input.action === 'memory-decision')
      return new Promise<RuntimeView>((resolve) => {
        finishAnswer = resolve;
      });
    return Promise.resolve(snapshot);
  });
  window.modelLoomRuntime = { command };
  const hook = renderHook(() => module.useRuntime());
  await waitFor(() => expect(hook.result.current.view).toEqual(base));
  let pending!: Promise<void>;
  act(() => {
    pending = hook.result.current.run({ action: 'load', modelId: 'model-123' });
  });
  snapshot = {
    ...base,
    phase: 'loading',
    loadingStage: 1,
    device: {
      name: 'Coordinator',
      os: 'Windows',
      cpuName: 'CPU',
      threads: 8,
      role: 'Coordinator',
      inventory: { sampledAt: 1000, cpuUsagePercent: 23 },
    },
    memoryWarning: { id: 'first' },
  };
  await waitFor(() => expect(hook.result.current.view?.memoryWarning?.id).toBe('first'));
  expect(hook.result.current.view?.phase).toBe('loading');
  expect(hook.result.current.view?.loadingStage).toBe(1);
  expect(hook.result.current.view?.device?.inventory?.cpuUsagePercent).toBe(23);
  expect(hook.result.current.loading).toBe(true);
  let answer!: Promise<void>;
  act(() => {
    answer = hook.result.current.answerMemory('first', false);
  });
  snapshot = {
    ...snapshot,
    loadingStage: 4,
    device: {
      ...snapshot.device!,
      inventory: { sampledAt: 18000, cpuUsagePercent: 47 },
    },
    memoryWarning: { id: 'second' },
  };
  await waitFor(() => expect(hook.result.current.view?.memoryWarning?.id).toBe('second'));
  await act(async () => {
    finishAnswer({ ...base, memoryWarning: null });
    await answer;
  });
  expect(hook.result.current.view?.memoryWarning?.id).toBe('second');
  expect(hook.result.current.view?.loadingStage).toBe(4);
  expect(hook.result.current.view?.device?.inventory?.sampledAt).toBe(18000);
  expect(hook.result.current.view?.device?.inventory?.cpuUsagePercent).toBe(47);
  expect(hook.result.current.loading).toBe(true);
  await act(async () => {
    finishLoad({ ...base, phase: 'ready', memoryWarning: null });
    await pending;
  });
  expect(hook.result.current.view?.phase).toBe('ready');
  expect(hook.result.current.loading).toBe(false);
  expect(command).toHaveBeenCalledWith({
    action: 'memory-decision',
    id: 'first',
    loadAnyway: false,
  });
  hook.unmount();
});

it('clears the previous failure on retry and ignores stale failed polls until that attempt finishes', async () => {
  const failed: RuntimeView = { enabled: true, model: null, phase: 'failed', error: 'Old failure' };
  let snapshot = failed;
  let finish!: (value: RuntimeView) => void;
  window.modelLoomRuntime = {
    command: (input) =>
      input.action === 'load'
        ? new Promise<RuntimeView>((resolve) => {
            finish = resolve;
          })
        : Promise.resolve(snapshot),
  };
  const hook = renderHook(() => module.useRuntime());
  await waitFor(() => expect(hook.result.current.view?.error).toBe('Old failure'));
  let pending!: Promise<void>;
  act(() => {
    pending = hook.result.current.run({ action: 'load', modelId: 'model-123' });
  });
  expect(hook.result.current.view?.error).toBeNull();
  await new Promise((resolve) => setTimeout(resolve, 550));
  expect(hook.result.current.view?.error).toBeNull();
  snapshot = { ...failed, phase: 'loading', error: null };
  await waitFor(() => expect(hook.result.current.view?.phase).toBe('loading'));
  await act(async () => {
    finish({ ...failed, error: 'New failure' });
    await pending;
  });
  expect(hook.result.current.view?.error).toBe('New failure');
  expect(hook.result.current.loading).toBe(false);
  hook.unmount();
});
