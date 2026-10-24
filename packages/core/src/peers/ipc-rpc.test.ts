import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { rpcIpcStream } from './ipc-rpc.js';
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
  expect(right.stream.readableLength).toBeLessThanOrEqual(16384);
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
