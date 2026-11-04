import { act, renderHook } from '@testing-library/react';
import { expect, it } from 'vitest';
import { useNavigationHistory } from './useNavigationHistory';

it('revisits locations without adding traversal entries and drops forward history on a new branch', () => {
  const hook = renderHook(() => useNavigationHistory());
  expect(hook.result.current.target(-1)).toBeNull();
  act(() => hook.result.current.visit({ destination: 'Settings', settingsCategory: 'Network' }));
  act(() => hook.result.current.visit({ settingsCategory: 'Storage' }));
  act(() => hook.result.current.visit({ settingsCategory: 'Storage' }));
  const back = hook.result.current.target(-1)!;
  expect(back.location.settingsCategory).toBe('Network');
  act(() => {
    hook.result.current.move(back);
  });
  expect(hook.result.current.location.settingsCategory).toBe('Network');
  expect(hook.result.current.target(1)?.location.settingsCategory).toBe('Storage');
  act(() => hook.result.current.visit({ destination: 'API' }));
  expect(hook.result.current.target(1)).toBeNull();
  act(() => {
    hook.result.current.move(hook.result.current.target(-1)!);
  });
  expect(hook.result.current.location.settingsCategory).toBe('Network');
});

it('does not move until a departure is accepted and rejects a target from a replaced branch', () => {
  const hook = renderHook(() => useNavigationHistory());
  act(() =>
    hook.result.current.visit({ destination: 'Cluster', clusterView: 'devices', deviceId: 'pc' }),
  );
  const back = hook.result.current.target(-1)!;
  expect(hook.result.current.location.destination).toBe('Cluster');
  act(() => {
    hook.result.current.move(back);
  });
  const abandoned = hook.result.current.target(1)!;
  act(() => hook.result.current.visit({ destination: 'Chat', chatId: 'chat-b' }));
  act(() => expect(hook.result.current.move(abandoned)).toBe(false));
  expect(hook.result.current.location.chatId).toBe('chat-b');
});

it('skips unavailable locations and replaces initial chat hydration without creating a visit', () => {
  const hook = renderHook(() => useNavigationHistory());
  act(() => hook.result.current.visit({ destination: 'Chat' }));
  act(() => hook.result.current.replace({ chatId: 'deleted' }));
  act(() => hook.result.current.visit({ chatId: 'kept' }));
  const back = hook.result.current.target(-1, (location) => location.chatId !== 'deleted');
  expect(back?.location.destination).toBe('Models');
});
