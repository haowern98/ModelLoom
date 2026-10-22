import { expect, it, vi } from 'vitest';
import { runPeerUtility } from './utility.js';
import type { PeerReply } from './wire.js';
import { PassThrough } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { rpcIpcStream } from './ipc-rpc.js';

it('publishes validated inventory changes and accepts hardware only from its admitted parent', async () => {
  let receive!: (message: unknown) => void;
  let changed!: (reply: PeerReply) => void;
  const send = vi.fn(),
    exit = vi.fn(),
    updateHardware = vi.fn(() => Promise.resolve()),
    unsubscribe = vi.fn();
  runPeerUtility(
    {
      receive: (handler) => {
        receive = handler;
      },
      send,
      exit,
    },
    () =>
      Promise.resolve({
        command: () => Promise.resolve<PeerReply>({ ok: false, error: 'NOT_READY' }),
        close: () => Promise.resolve(),
        updateHardware,
        subscribe: (handler: (reply: PeerReply) => void) => {
          changed = handler;
          return unsubscribe;
        },
      }),
  );
  receive(JSON.stringify({ type: 'admit', applicationData: 'E:/test-peer', caller: 'window' }));
  await vi.waitFor(() => expect(send).toHaveBeenCalledWith(JSON.stringify({ type: 'ready' })));
  const hardware = { os: 'Windows', sampledAt: 1, gpus: [] };
  receive(JSON.stringify({ type: 'hardware-update', hardware }));
  await vi.waitFor(() => expect(updateHardware).toHaveBeenCalledWith(hardware));
  changed({ ok: false, error: 'PEER_UNAVAILABLE' });
  expect(send).toHaveBeenCalledWith(
    JSON.stringify({ type: 'peer-changed', reply: { ok: false, error: 'PEER_UNAVAILABLE' } }),
  );
  receive(JSON.stringify({ type: 'quit' }));
  await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
  expect(unsubscribe).toHaveBeenCalled();
});

it('does not open an identity before trusted admission, rejects caller substitution, and closes on Quit', async () => {
  let receive!: (message: unknown) => void;
  const send = vi.fn(),
    exit = vi.fn();
  const close = vi.fn(() => Promise.resolve());
  const command = vi.fn(() => Promise.resolve<PeerReply>({ ok: false, error: 'NOT_READY' }));
  const open = vi.fn(() => Promise.resolve({ close, command }));
  runPeerUtility(
    {
      receive: (handler) => {
        receive = handler;
      },
      send,
      exit,
    },
    open,
  );
  expect(open).not.toHaveBeenCalled();
  receive(JSON.stringify({ type: 'admit', applicationData: 'E:/test-peer', caller: 'window' }));
  receive(
    JSON.stringify({
      type: 'command',
      id: 1,
      caller: 'another-window',
      command: { action: 'read' },
    }),
  );
  await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
  expect(command).not.toHaveBeenCalled();
  expect(open).toHaveBeenCalledWith('E:/test-peer', 'window');
  await vi.waitFor(() => expect(close).toHaveBeenCalled());
});

it('never turns an out-of-order command into peer authority', async () => {
  let receive!: (message: unknown) => void;
  const exit = vi.fn(),
    command = vi.fn(() => Promise.resolve<PeerReply>({ ok: false, error: 'NOT_READY' }));
  runPeerUtility(
    {
      receive: (handler) => {
        receive = handler;
      },
      send: vi.fn(),
      exit,
    },
    () => Promise.resolve({ command, close: () => Promise.resolve() }),
  );
  receive(
    JSON.stringify({ type: 'command', id: 1, caller: 'window', command: { action: 'read' } }),
  );
  await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
  expect(command).not.toHaveBeenCalled();
});

it('relays an owned RPC connection through the parent-only channel and tears it down on Quit', async () => {
  let receive!: (message: unknown) => void;
  const id = randomUUID(),
    socket = new PassThrough();
  const openRpc = vi.fn(() => Promise.resolve(socket));
  let ready!: () => void;
  const connected = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const pipe = rpcIpcStream(id, (value) => queueMicrotask(() => receive(JSON.stringify(value))));
  const exit = vi.fn();
  runPeerUtility(
    {
      receive: (handler) => {
        receive = handler;
      },
      exit,
      send: (text) => {
        const value: unknown = JSON.parse(text);
        if (value && typeof value === 'object' && Reflect.get(value, 'type') === 'rpc-ready')
          ready();
        else if (
          value &&
          typeof value === 'object' &&
          String(Reflect.get(value, 'type')).startsWith('rpc-')
        )
          queueMicrotask(() => pipe.receive(value));
      },
    },
    () =>
      Promise.resolve({
        command: () => Promise.resolve({ ok: false, error: 'NOT_READY' }),
        close: () => Promise.resolve(),
        openRpc,
      }),
  );
  receive(JSON.stringify({ type: 'admit', applicationData: 'E:/test-peer', caller: 'window' }));
  const device = `peer:${'a'.repeat(64)}:GPU-11111111-1111-1111-1111-111111111111`;
  receive(JSON.stringify({ type: 'rpc-open', id, device }));
  await connected;
  const response = new Promise<Buffer>((resolve) => pipe.stream.once('data', resolve));
  pipe.stream.write(Buffer.from('opaque native bytes'));
  expect((await response).toString()).toBe('opaque native bytes');
  expect(openRpc).toHaveBeenCalledWith(device);
  receive(JSON.stringify({ type: 'quit' }));
  await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
  expect(socket.destroyed).toBe(true);
  expect(pipe.stream.destroyed).toBe(true);
});
