import { Duplex } from 'node:stream';
import { expect, it, vi } from 'vitest';
import { RpcRelaySession } from './rpc-session.js';

function frame(kind: number, payload = Buffer.alloc(0)): Buffer {
  const header = Buffer.alloc(5);
  header.writeUInt32LE(payload.length + 1);
  header[4] = kind;
  return Buffer.concat([header, payload]);
}
function fixture() {
  const writes: Buffer[] = [];
  let stopped = false;
  const transport = new Duplex({
    read() {},
    write(chunk: Buffer, _encoding, callback) {
      writes.push(Buffer.from(chunk));
      callback();
    },
  });
  const session = new RpcRelaySession({
    stream: transport,
    close() {
      stopped = true;
      transport.destroy();
      return Promise.resolve();
    },
  });
  const ready = () =>
    transport.push(
      frame(
        1,
        Buffer.from(
          JSON.stringify({
            phase: 'relay-ready',
            workerRestricted: true,
          }),
        ),
      ),
    );
  return { session, transport, writes, ready, stopped: () => stopped };
}

it('reuses one helper for two workers and waits for confirmed cleanup before reopening', async () => {
  const f = fixture();
  for (let i = 0; i < 2; i++) {
    const opening = f.session.start();
    f.ready();
    const worker = await opening;
    await expect(f.session.start()).rejects.toThrow('RPC_BUSY');
    worker.stream.write(Buffer.from([14, 0, 255]));
    const closing = worker.close();
    await expect(f.session.start()).rejects.toThrow('RPC_BUSY');
    f.transport.push(frame(3));
    await closing;
    expect(f.stopped()).toBe(false);
  }
  expect(f.writes.map((bytes) => bytes[4])).toEqual([1, 2, 3, 1, 2, 3]);
  await f.session.close();
  expect(f.stopped()).toBe(true);
});

it('preserves fragmented opaque RPC bytes and handles unexpected worker EOF', async () => {
  const f = fixture();
  const opening = f.session.start();
  f.ready();
  const worker = await opening;
  const chunks: Buffer[] = [];
  worker.stream.on('data', (chunk: Buffer) => chunks.push(chunk));
  const bytes = frame(2, Buffer.from([0, 255, 10, 1]));
  for (const byte of bytes) f.transport.push(Buffer.from([byte]));
  await new Promise((resolve) => setImmediate(resolve));
  expect(Buffer.concat(chunks)).toEqual(Buffer.from([0, 255, 10, 1]));
  f.transport.push(frame(4));
  await new Promise((resolve) => setImmediate(resolve));
  expect(f.writes.at(-1)?.[4]).toBe(3);
  f.transport.push(frame(3));
  await worker.close();
  await f.session.close();
});

it.each(['oversized', 'data-before-ready', 'unsolicited-close', 'duplicate-ready'])(
  'fails closed for %s and never automatically starts another helper',
  async (scenario) => {
    const f = fixture();
    const opening = f.session.start();
    const rejected = expect(opening).rejects.toThrow();
    if (scenario === 'oversized') {
      const header = Buffer.alloc(4);
      header.writeUInt32LE(262146);
      f.transport.push(header);
    } else if (scenario === 'data-before-ready') f.transport.push(frame(2, Buffer.from('x')));
    else if (scenario === 'unsolicited-close') f.transport.push(frame(3));
    else {
      f.ready();
      // Reject the active stream/session even if the opening already resolved.
      await opening;
      f.ready();
    }
    if (scenario !== 'duplicate-ready') await rejected;
    else void rejected.catch(() => undefined);
    await expect(f.session.start()).rejects.toThrow('RPC_UNAVAILABLE');
    await f.session.close().catch(() => undefined);
    expect(f.stopped()).toBe(true);
  },
);

it('does not confirm cleanup when the helper disappears before acknowledging close', async () => {
  const f = fixture();
  const opening = f.session.start();
  f.ready();
  const worker = await opening;
  const closing = worker.close();
  f.transport.destroy();
  await expect(closing).rejects.toThrow('RPC_CLEANUP_FAILED');
  await expect(f.session.start()).rejects.toThrow('RPC_UNAVAILABLE');
  await f.session.close().catch(() => undefined);
});

it('confirms cleanup if sharing stops while a worker is still starting', async () => {
  const f = fixture();
  const opening = f.session.start();
  const rejected = expect(opening).rejects.toThrow('RPC_UNAVAILABLE');
  const closing = f.session.close();
  // A worker already starting can report Ready before it reads the queued Close.
  f.ready();
  f.transport.push(frame(3));
  await rejected;
  await closing;
  expect(f.stopped()).toBe(true);
});

it('accepts confirmed helper teardown after the worker close acknowledgement is lost', async () => {
  const f = fixture();
  const opening = f.session.start();
  f.ready();
  const worker = await opening;
  const closing = worker.close();
  f.transport.destroy();
  await expect(closing).rejects.toThrow('RPC_CLEANUP_FAILED');
  await expect(f.session.close()).resolves.toBeUndefined();
  expect(f.stopped()).toBe(true);
});

it('still refuses cleanup when helper teardown itself cannot be confirmed', async () => {
  const transport = new Duplex({
    read() {},
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  const session = new RpcRelaySession({
    stream: transport,
    close: () => Promise.reject(Error('RPC_CLEANUP_FAILED')),
  });
  await expect(session.close()).rejects.toThrow('RPC_CLEANUP_FAILED');
  transport.destroy();
});

it('can retry a previously timed-out helper cleanup and accept its later exit proof', async () => {
  const transport = new Duplex({
    read() {},
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  const close = vi
    .fn()
    .mockRejectedValueOnce(Error('RPC_CLEANUP_FAILED'))
    .mockResolvedValue(undefined);
  const session = new RpcRelaySession({ stream: transport, close });
  await expect(session.close()).rejects.toThrow('RPC_CLEANUP_FAILED');
  await expect(session.close()).resolves.toBeUndefined();
  expect(close).toHaveBeenCalledTimes(2);
  transport.destroy();
});
