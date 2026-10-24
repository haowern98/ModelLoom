import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { usePeerInventory } from './usePeerInventory';
import type { PeerReply, PeerView } from '../../../shared/peers';
const view: PeerView = {
  fingerprint: 'a'.repeat(64),
  name: 'Local',
  sharing: false,
  addresses: [],
  gpus: [],
  sharedGpuIds: [],
  incoming: [],
  outgoing: [],
};
const reply = (name: string): PeerReply => ({ ok: true, view: { ...view, name } });
afterEach(() => {
  cleanup();
  delete window.modelLoomPeers;
  vi.useRealTimers();
});
it('coalesces invalidations during reads, discards stale replies and unsubscribes', async () => {
  let listener = () => {};
  let resolve!: (value: PeerReply) => void;
  const unsubscribe = vi.fn();
  const command = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<PeerReply>((r) => {
          resolve = r;
        }),
    )
    .mockResolvedValue(reply('Fresh'));
  window.modelLoomPeers = {
    command,
    subscribe: (fn) => {
      listener = fn;
      return unsubscribe;
    },
  };
  const hook = renderHook(() => usePeerInventory(true));
  act(() => {
    listener();
    listener();
  });
  expect(command).toHaveBeenCalledTimes(1);
  await act(async () => {
    await Promise.resolve();
    resolve(reply('Stale'));
  });
  expect(command).toHaveBeenCalledTimes(2);
  expect(hook.result.current?.name).toBe('Fresh');
  hook.unmount();
  expect(unsubscribe).toHaveBeenCalledOnce();
});
it('retains accepted data during invalidation, clears on failure and suppresses calls after cleanup', async () => {
  let listener = () => {};
  let resolve!: (value: PeerReply) => void;
  const command = vi
    .fn()
    .mockResolvedValueOnce(reply('Live'))
    .mockImplementationOnce(
      () =>
        new Promise<PeerReply>((r) => {
          resolve = r;
        }),
    );
  window.modelLoomPeers = {
    command,
    subscribe: (fn) => {
      listener = fn;
      return () => {};
    },
  };
  const hook = renderHook(() => usePeerInventory(true));
  await act(async () => {
    await Promise.resolve();
  });
  expect(hook.result.current?.name).toBe('Live');
  act(() => listener());
  expect(hook.result.current?.name).toBe('Live');
  await act(async () => {
    await Promise.resolve();
    resolve({ ok: false, error: 'DISCONNECTED' });
  });
  expect(hook.result.current).toBeNull();
  hook.unmount();
  act(() => listener());
  expect(command).toHaveBeenCalledTimes(2);
});
it('refreshes older bridges after 1500ms', async () => {
  vi.useFakeTimers();
  const command = vi.fn().mockResolvedValue(reply('Fallback'));
  window.modelLoomPeers = { command };
  renderHook(() => usePeerInventory(true));
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
    vi.advanceTimersByTime(1500);
  });
  expect(command).toHaveBeenCalledTimes(2);
});
it('uses a slower fallback with events and ignores pending replies after disabling', async () => {
  vi.useFakeTimers();
  let resolve!: (value: PeerReply) => void;
  const unsubscribe = vi.fn();
  const command = vi
    .fn()
    .mockResolvedValueOnce(reply('Live'))
    .mockImplementationOnce(
      () =>
        new Promise<PeerReply>((done) => {
          resolve = done;
        }),
    );
  window.modelLoomPeers = { command, subscribe: () => unsubscribe };
  const hook = renderHook(({ enabled }) => usePeerInventory(enabled), {
    initialProps: { enabled: true },
  });
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
    vi.advanceTimersByTime(9999);
  });
  expect(command).toHaveBeenCalledTimes(1);
  await act(async () => {
    await Promise.resolve();
    vi.advanceTimersByTime(1);
  });
  expect(command).toHaveBeenCalledTimes(2);
  hook.rerender({ enabled: false });
  await act(async () => {
    await Promise.resolve();
    resolve(reply('Late'));
    vi.advanceTimersByTime(30000);
  });
  expect(hook.result.current).toBeNull();
  expect(command).toHaveBeenCalledTimes(2);
  expect(unsubscribe).toHaveBeenCalledOnce();
});
