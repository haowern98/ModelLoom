import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { rpcIpcStream, RPC_IPC_FRAME_BYTES } from './ipc-rpc.js';
import { GENERATION_POLICY } from '../generation/contracts.js';

it('carries opaque bytes with bounded backpressure and closes both ends', async () => {
  const id = randomUUID();
  const left: ReturnType<typeof rpcIpcStream> = rpcIpcStream(id, (value) =>
    queueMicrotask(() => right.receive(value)),
  );
  const right: ReturnType<typeof rpcIpcStream> = rpcIpcStream(id, (value) =>
    queueMicrotask(() => left.receive(value)),
  );
  const expected = Buffer.alloc(65536, 173),
    chunks: Buffer[] = [];
  let written = false;
  left.stream.write(expected, () => {
    written = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(written).toBe(false);
  expect(right.stream.readableLength).toBeLessThanOrEqual(2 * RPC_IPC_FRAME_BYTES);
  const received = new Promise<void>((resolve) => {
    right.stream.on('data', (bytes: Buffer) => {
      chunks.push(bytes);
      if (chunks.reduce((sum, chunk) => sum + chunk.length, 0) === expected.length) resolve();
    });
  });
  await received;
  expect(Buffer.concat(chunks)).toEqual(expected);
  const closed = once(right.stream, 'close');
  left.stream.destroy();
  await closed;
});

it('rejects a forged channel or out-of-order data before accepting its bytes', () => {
  const id = randomUUID(),
    pipe = rpcIpcStream(id, () => undefined);
  expect(() =>
    pipe.receive({ type: 'rpc-data', id: randomUUID(), sequence: 1, bytes: 'YQ==' }),
  ).toThrow('INVALID_RPC_CHANNEL');
  expect(() => pipe.receive({ type: 'rpc-data', id, sequence: 2, bytes: 'YQ==' })).toThrow(
    'INVALID_RPC_CHANNEL',
  );
  expect(pipe.stream.readableLength).toBe(0);
  pipe.stream.destroy();
});

it('keeps bounded bytes pending through native backpressure beyond fifteen seconds', async () => {
  vi.useFakeTimers();
  const id = randomUUID();
  const pipe = rpcIpcStream(id, () => undefined);
  let written = false;
  pipe.stream.write(Buffer.alloc(8192), () => {
    written = true;
  });
  try {
    await vi.advanceTimersByTimeAsync(60000);
    expect(pipe.stream.destroyed).toBe(false);
    expect(written).toBe(false);
    pipe.receive({ type: 'rpc-ack', id, sequence: 1 });
    expect(written).toBe(true);
  } finally {
    pipe.stream.destroy();
    vi.useRealTimers();
  }
});

it('still closes an unacknowledged bounded fragment after the full execution budget', async () => {
  vi.useFakeTimers();
  const pipe = rpcIpcStream(randomUUID(), () => undefined);
  let failure: Error | null | undefined;
  pipe.stream.write(Buffer.alloc(8192), (error) => {
    failure = error;
  });
  try {
    await vi.advanceTimersByTimeAsync(GENERATION_POLICY.generationMs);
    expect(pipe.stream.destroyed).toBe(true);
    expect(failure?.message).toBe('RPC_IPC_TIMEOUT');
  } finally {
    pipe.stream.destroy();
    vi.useRealTimers();
  }
});

it('carries a full encrypted TLS record without serial acknowledgement-sized fragments', async () => {
  const id = randomUUID();
  const frames: number[] = [];
  const left = rpcIpcStream(id, (message) => {
    if (message.type === 'rpc-data') frames.push(Buffer.from(message.bytes, 'base64').length);
    queueMicrotask(() => right.receive(message));
  });
  const right = rpcIpcStream(id, (message) => queueMicrotask(() => left.receive(message)));
  const input = Buffer.alloc(16 * 1024 + 22, 173);
  const received: Buffer[] = [];
  const delivered = new Promise<void>((resolve) =>
    right.stream.on('data', (bytes: Buffer) => {
      received.push(bytes);
      if (received.reduce((total, part) => total + part.length, 0) === input.length) resolve();
    }),
  );
  try {
    await new Promise<void>((resolve, reject) =>
      left.stream.write(input, (error) => (error ? reject(error) : resolve())),
    );
    await delivered;
    expect(Buffer.concat(received).equals(input)).toBe(true);
    expect(frames).toEqual([input.length]);
  } finally {
    const closed = once(right.stream, 'close');
    left.stream.destroy();
    await closed;
  }
});

it('rejects oversized and noncanonical data before accepting bytes', () => {
  for (const bytes of [Buffer.alloc(32769).toString('base64'), 'YQ', 'YQ===']) {
    const id = randomUUID();
    const pipe = rpcIpcStream(id, () => undefined);
    try {
      expect(() => pipe.receive({ type: 'rpc-data', id, sequence: 1, bytes })).toThrow(
        'INVALID_RPC_CHANNEL',
      );
      expect(pipe.stream.readableLength).toBe(0);
    } finally {
      pipe.stream.destroy();
    }
  }
});
