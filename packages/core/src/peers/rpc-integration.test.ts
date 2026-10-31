import { connect } from 'node:net';
import { PassThrough } from 'node:stream';
import { expect, it, vi } from 'vitest';
import { localRpcGateway } from './rpc.js';

it('records the original gateway setup error without leaking arbitrary error text', async () => {
  const output = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const lost = vi.fn();
  const gateway = await localRpcGateway(
    (pid) => pid === process.pid,
    () => Promise.reject(Object.assign(Error('private credential'), { code: 'ECONNREFUSED' })),
    lost,
  );
  const socket = connect(gateway.port, '127.0.0.1');
  socket.on('error', () => undefined);
  try {
    await vi.waitFor(() => expect(lost).toHaveBeenCalledTimes(1));
    const log = output.mock.calls.flat().join('\n');
    expect(log).toContain('gateway-open');
    expect(log).toContain('ECONNREFUSED');
    expect(log).toContain('rpc.failure-context');
    expect(log).not.toContain('private credential');
  } finally {
    socket.destroy();
    await gateway.close();
    output.mockRestore();
  }
});

it('rejects an unrelated process identity before opening the RPC stream', async () => {
  let opened = false;
  const gateway = await localRpcGateway(
    () => false,
    () => {
      opened = true;
      return Promise.resolve(new PassThrough());
    },
  );
  try {
    const socket = connect(gateway.port, '127.0.0.1');
    await new Promise<void>((resolve) => {
      socket.once('error', () => resolve());
      socket.once('close', () => resolve());
    });
    expect(opened).toBe(false);
  } finally {
    await gateway.close();
  }
});
it('admits the current retained process by its actual loopback tuple', async () => {
  let seen = 0;
  const gateway = await localRpcGateway(
    (pid) => {
      seen = pid;
      return pid === process.pid;
    },
    () => Promise.resolve(new PassThrough()),
  );
  const socket = connect(gateway.port, '127.0.0.1');
  try {
    const reply = new Promise<Buffer>((resolve, reject) => {
      socket.once('data', resolve);
      socket.once('error', reject);
    });
    socket.write('opaque bytes');
    expect((await reply).toString()).toBe('opaque bytes');
    expect(seen).toBe(process.pid);
    expect(gateway.progress()).toEqual({ uploaded: 12, downloaded: 12 });
  } finally {
    socket.destroy();
    await gateway.close();
  }
});

it('can close while an admitted peer connection never finishes opening', async () => {
  let opening!: () => void;
  const started = new Promise<void>((resolve) => {
    opening = resolve;
  });
  const gateway = await localRpcGateway(
    (pid) => pid === process.pid,
    () => {
      opening();
      return new Promise(() => {});
    },
  );
  const socket = connect(gateway.port, '127.0.0.1');
  socket.on('error', () => undefined);
  await started;
  await gateway.close();
  socket.destroy();
});

it('keeps an owned gateway connection open for the worker startup budget', async () => {
  const opening = new Promise<PassThrough>((resolve) => {
    setTimeout(() => resolve(new PassThrough()), 17_000);
  });
  const gateway = await localRpcGateway(
    (pid) => pid === process.pid,
    () => opening,
  );
  const socket = connect(gateway.port, '127.0.0.1');
  try {
    const received = new Promise<Buffer>((resolve, reject) => {
      socket.once('data', resolve);
      socket.once('error', reject);
      socket.once('close', () => reject(new Error('Gateway closed during worker startup')));
    });
    socket.write('owned bytes');
    expect((await received).toString()).toBe('owned bytes');
  } finally {
    socket.destroy();
    await gateway.close();
    (await opening).destroy();
  }
}, 30_000);

it('notifies the runtime owner when an admitted remote transport closes', async () => {
  const remote = new PassThrough();
  const lost = vi.fn();
  const gateway = await localRpcGateway(
    (pid) => pid === process.pid,
    () => Promise.resolve(remote),
    lost,
  );
  const socket = connect(gateway.port, '127.0.0.1');
  socket.on('error', () => undefined);
  try {
    const echoed = new Promise((resolve) => socket.once('data', resolve));
    socket.write('connected');
    await echoed;
    remote.destroy();
    await vi.waitFor(() => expect(lost).toHaveBeenCalledTimes(1));
  } finally {
    socket.destroy();
    await gateway.close();
  }
});

it.each(['error', 'end'] as const)(
  'reports remote %s before piping can close the local socket',
  async (kind) => {
    const remote = new PassThrough();
    const lost = vi.fn();
    const gateway = await localRpcGateway(
      (pid) => pid === process.pid,
      () => Promise.resolve(remote),
      lost,
    );
    const socket = connect(gateway.port, '127.0.0.1');
    socket.on('error', () => undefined);
    try {
      const echoed = new Promise((resolve) => socket.once('data', resolve));
      socket.write('connected');
      await echoed;
      if (kind === 'error') remote.destroy(Error('Disconnected fixture'));
      else remote.end();
      await vi.waitFor(() => expect(lost).toHaveBeenCalledTimes(1));
    } finally {
      socket.destroy();
      await gateway.close();
    }
  },
);

it('does not report owner-requested gateway shutdown as remote loss', async () => {
  const remote = new PassThrough();
  const lost = vi.fn();
  const gateway = await localRpcGateway(
    (pid) => pid === process.pid,
    () => Promise.resolve(remote),
    lost,
  );
  const socket = connect(gateway.port, '127.0.0.1');
  socket.on('error', () => undefined);
  const echoed = new Promise((resolve) => socket.once('data', resolve));
  socket.write('connected');
  await echoed;
  await gateway.close();
  socket.destroy();
  expect(lost).not.toHaveBeenCalled();
});

it('allows the admitted stock client to close an enumeration connection normally', async () => {
  const remote = new PassThrough();
  const lost = vi.fn();
  const gateway = await localRpcGateway(
    (pid) => pid === process.pid,
    () => Promise.resolve(remote),
    lost,
  );
  const socket = connect(gateway.port, '127.0.0.1');
  socket.on('error', () => undefined);
  try {
    const echoed = new Promise((resolve) => socket.once('data', resolve));
    socket.write('enumeration');
    await echoed;
    socket.end();
    await vi.waitFor(() => expect(remote.destroyed).toBe(true));
    expect(lost).not.toHaveBeenCalled();
  } finally {
    socket.destroy();
    await gateway.close();
  }
});
