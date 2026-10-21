import { EventEmitter } from 'node:events';
import { expect, it, vi } from 'vitest';
import { createDesktopEngineHost } from './desktop.js';
import type { UtilityChild } from './desktop.js';

it.each([180_000, 1_800_000])(
  'keeps the desktop watchdog outside the owner startup budget %s',
  async (startupMs) => {
    vi.useFakeTimers();
    const events = new EventEmitter();
    const kill = vi.fn(() => {
      events.emit('exit');
      return true;
    });
    const child: UtilityChild = Object.assign(events, { pid: 123, postMessage: () => {}, kill });
    const closed = vi.fn(() => Promise.resolve());
    try {
      const opening = createDesktopEngineHost(() => child, {
        adapter: { launch: () => Promise.reject(new Error('Unexpected launch')) },
        startupMs: () => startupMs,
        children: () => [],
        admitCore: () => {},
        close: closed,
      });
      events.emit('spawn');
      events.emit('message', JSON.stringify({ type: 'booted' }));
      const host = await opening;
      const response = host
        .command(JSON.stringify({ id: 1, action: 'load' }))
        .catch((error: unknown) => (error instanceof Error ? error.message : 'Unexpected error'));
      await vi.advanceTimersByTimeAsync(startupMs + 4_999);
      expect(kill).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(await response).toBe('CORE_TIMEOUT');
      expect(kill).toHaveBeenCalledTimes(1);
      await host.close();
      expect(closed).toHaveBeenCalledTimes(1);
    } finally {
      events.emit('exit');
      vi.useRealTimers();
    }
  },
);
