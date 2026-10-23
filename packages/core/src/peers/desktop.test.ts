import { EventEmitter } from 'node:events';
import { beforeEach, expect, it, vi } from 'vitest';
import { createDesktopPeerHost } from './desktop.js';

const owned = vi.hoisted(() => ({ admit: vi.fn(), close: vi.fn(), exited: vi.fn(() => true) }));
vi.mock('../hosts/windows-ownership.js', () => ({
  ownershipBinding: () => ({
    createDeployment: () => ({}),
    admitCore: owned.admit,
    closeDeployment: owned.close,
    coresExited: owned.exited,
  }),
  confirmExit: (done: () => boolean) =>
    done() ? Promise.resolve() : Promise.reject(new Error('CLEANUP_FAILED')),
}));
beforeEach(() => {
  vi.clearAllMocks();
});

it('binds peer management to the admitted caller and stops its retained owner independently of model hosts', async () => {
  const events = new EventEmitter();
  const postMessage = vi.fn((text: string) => {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== 'object') throw new Error('Invalid test setup');
    const type: unknown = Reflect.get(value, 'type');
    queueMicrotask(() => {
      if (type === 'admit') events.emit('message', JSON.stringify({ type: 'ready' }));
      else if (type === 'quit') {
        events.emit('message', JSON.stringify({ type: 'closed' }));
        events.emit('exit', 0);
      } else {
        const id: unknown = Reflect.get(value, 'id');
        events.emit(
          'message',
          JSON.stringify({
            type: 'reply',
            id,
            reply: { ok: false, error: 'PEER_UNAVAILABLE' },
          }),
        );
      }
    });
  });
  const fork = vi.fn(() => {
    queueMicrotask(() => {
      events.emit('spawn');
      events.emit('message', JSON.stringify({ type: 'booted' }));
    });
    return { pid: 1234, postMessage, on: events.on.bind(events), kill: vi.fn(() => true) };
  });
  const host = await createDesktopPeerHost(fork, 'E:/private-profile', 'window');
  expect(owned.admit).toHaveBeenCalledWith(
    expect.any(Object),
    1234,
    process.execPath,
    expect.any(Number),
  );
  const calls = postMessage.mock.calls.length;
  const changed = vi.fn();
  const unsubscribe = host.subscribe(changed);
  events.emit(
    'message',
    JSON.stringify({ type: 'peer-changed', reply: { ok: false, error: 'PEER_UNAVAILABLE' } }),
  );
  expect(changed).toHaveBeenCalledWith({ ok: false, error: 'PEER_UNAVAILABLE' });
  unsubscribe();
  events.emit(
    'message',
    JSON.stringify({ type: 'peer-changed', reply: { ok: false, error: 'PEER_UNAVAILABLE' } }),
  );
  expect(changed).toHaveBeenCalledTimes(1);
  expect(await host.command('other', { action: 'read' })).toEqual({
    ok: false,
    error: 'NOT_READY',
  });
  expect(postMessage).toHaveBeenCalledTimes(calls);
  expect(await host.command('window', { action: 'read' })).toEqual({
    ok: false,
    error: 'PEER_UNAVAILABLE',
  });
  await host.close();
  expect(owned.close).toHaveBeenCalled();
  expect(await host.command('window', { action: 'read' })).toEqual({
    ok: false,
    error: 'NOT_READY',
  });
});

it('allows status verification and the full approved RPC startup budget across IPC', async () => {
  vi.useFakeTimers();
  const events = new EventEmitter();
  const postMessage = (text: string) => {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== 'object') throw Error('Invalid fixture');
    const type: unknown = Reflect.get(value, 'type');
    const id: unknown = Reflect.get(value, 'id');
    if (type === 'admit')
      queueMicrotask(() => events.emit('message', JSON.stringify({ type: 'ready' })));
    if (type === 'quit')
      queueMicrotask(() => {
        events.emit('message', JSON.stringify({ type: 'closed' }));
        events.emit('exit', 0);
      });
    if (type === 'rpc-open')
      setTimeout(() => events.emit('message', JSON.stringify({ type: 'rpc-ready', id })), 22_000);
  };
  const opening = createDesktopPeerHost(
    () => {
      queueMicrotask(() => {
        events.emit('spawn');
        events.emit('message', JSON.stringify({ type: 'booted' }));
      });
      return { pid: 1234, postMessage, on: events.on.bind(events), kill: () => true };
    },
    'E:/private-profile',
    'window',
  );
  const host = await opening;
  try {
    const rpc = host
      .openRpc('peer:' + 'a'.repeat(64) + ':GPU-11111111-1111-1111-1111-111111111111')
      .catch((error: unknown) => (error instanceof Error ? error.message : 'Unexpected failure'));
    await vi.advanceTimersByTimeAsync(22_000);
    const result = await rpc;
    expect(typeof result).toBe('object');
    if (typeof result === 'object') result.destroy();
  } finally {
    await host.close();
    vi.useRealTimers();
  }
});

it.each([
  { gpuCount: 1, replyAfter: 35000 },
  { gpuCount: 2, replyAfter: 150000 },
])(
  'allows sharing admission for $gpuCount GPUs without extending ordinary peer commands',
  async ({ gpuCount, replyAfter }) => {
    vi.useFakeTimers();
    const events = new EventEmitter();
    const postMessage = (text: string) => {
      const value = JSON.parse(text) as { type: string; id?: number };
      if (value.type === 'admit')
        queueMicrotask(() => events.emit('message', JSON.stringify({ type: 'ready' })));
      if (value.type === 'quit')
        queueMicrotask(() => {
          events.emit('message', JSON.stringify({ type: 'closed' }));
          events.emit('exit', 0);
        });
      if (value.type === 'command')
        setTimeout(
          () =>
            events.emit(
              'message',
              JSON.stringify({
                type: 'reply',
                id: value.id,
                reply: { ok: false, error: 'PEER_UNAVAILABLE' },
              }),
            ),
          replyAfter,
        );
    };
    const host = await createDesktopPeerHost(
      () => {
        queueMicrotask(() => {
          events.emit('spawn');
          events.emit('message', JSON.stringify({ type: 'booted' }));
        });
        return { pid: 1234, postMessage, on: events.on.bind(events), kill: () => true };
      },
      'E:/private-profile',
      'window',
    );
    try {
      const sharing = host
        .command('window', {
          action: 'share',
          address: '100.69.84.91',
          gpuIds: [
            'GPU-11111111-1111-1111-1111-111111111111',
            'GPU-22222222-2222-2222-2222-222222222222',
          ].slice(0, gpuCount),
        })
        .catch((error: unknown) => String(error));
      await vi.advanceTimersByTimeAsync(replyAfter);
      expect(await sharing).toEqual({ ok: false, error: 'PEER_UNAVAILABLE' });
      const read = host
        .command('window', { action: 'read' })
        .catch((error: unknown) => String(error));
      await vi.advanceTimersByTimeAsync(20000);
      expect(await read).toContain('PEER_TIMEOUT');
    } finally {
      await host.close();
      vi.useRealTimers();
    }
  },
);

it.each([
  { receipt: false, code: 0 },
  { receipt: true, code: 1 },
])('does not treat a core exit as confirmed helper cleanup: %j', async ({ receipt, code }) => {
  const events = new EventEmitter();
  const host = await createDesktopPeerHost(
    () => {
      queueMicrotask(() => {
        events.emit('spawn');
        events.emit('message', JSON.stringify({ type: 'booted' }));
      });
      return {
        pid: 1234,
        on: events.on.bind(events),
        kill: () => true,
        postMessage(text: string) {
          const command = JSON.parse(text) as { type: string };
          queueMicrotask(() => {
            if (command.type === 'admit') events.emit('message', JSON.stringify({ type: 'ready' }));
            if (command.type === 'quit') {
              if (receipt) events.emit('message', JSON.stringify({ type: 'closed' }));
              events.emit('exit', code);
            }
          });
        },
      };
    },
    'E:/private-profile',
    'window',
  );
  await expect(host.close()).rejects.toThrow('PEER_CLEANUP_FAILED');
});

it('allows confirmed sharing cleanup beyond the old outer twenty-second deadline', async () => {
  vi.useFakeTimers();
  const events = new EventEmitter();
  const host = await createDesktopPeerHost(
    () => {
      queueMicrotask(() => {
        events.emit('spawn');
        events.emit('message', JSON.stringify({ type: 'booted' }));
      });
      return {
        pid: 1234,
        on: events.on.bind(events),
        kill: () => true,
        postMessage(text: string) {
          const message = JSON.parse(text) as { type: string; id: number };
          if (message.type === 'admit')
            queueMicrotask(() => events.emit('message', JSON.stringify({ type: 'ready' })));
          if (message.type === 'command')
            setTimeout(
              () =>
                events.emit(
                  'message',
                  JSON.stringify({
                    type: 'reply',
                    id: message.id,
                    reply: { ok: false, error: 'NOT_READY' },
                  }),
                ),
              35000,
            );
          if (message.type === 'quit')
            setTimeout(() => {
              events.emit('message', JSON.stringify({ type: 'closed' }));
              events.emit('exit', 0);
            }, 40000);
        },
      };
    },
    'E:/private-profile',
    'window',
  );
  try {
    const stopping = host
      .command('window', { action: 'stop-sharing' })
      .catch((error: Error) => error.message);
    await vi.advanceTimersByTimeAsync(35000);
    expect(await stopping).toEqual({ ok: false, error: 'NOT_READY' });
    const closing = host.close().then(
      () => 'confirmed',
      (error: Error) => error.message,
    );
    await vi.advanceTimersByTimeAsync(40000);
    expect(await closing).toBe('confirmed');
  } finally {
    events.emit('exit', 0);
    vi.useRealTimers();
  }
});
