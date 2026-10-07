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
