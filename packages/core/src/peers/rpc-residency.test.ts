import { duplexPair } from 'node:stream';
import type { Duplex } from 'node:stream';
import { once } from 'node:events';
import { expect, it } from 'vitest';
import { rpcResidencyStream } from './rpc-residency.js';

function hello(major = 8) {
  const b = Buffer.alloc(12);
  b.writeBigUInt64LE(4n);
  b[8] = major;
  return b;
}
function request(payload: Buffer, cmd = 6) {
  const h = Buffer.alloc(9);
  h[0] = cmd;
  h.writeBigUInt64LE(BigInt(payload.length), 1);
  return Buffer.concat([h, payload]);
}
async function write(stream: Duplex, b: Buffer) {
  await new Promise<void>((resolve, reject) => stream.write(b, (e) => (e ? reject(e) : resolve())));
}
async function read(stream: Duplex, size: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let n = 0;
  while (n < size) {
    const b: unknown = stream.read(size - n);
    if (Buffer.isBuffer(b)) {
      chunks.push(b);
      n += b.length;
    } else {
      if (stream.destroyed) throw Error('closed');
      await once(stream, 'readable');
    }
  }
  return Buffer.concat(chunks, size);
}

it.each([6, 7, 8])(
  'carries exact protocol %i requests and opaque real responses over paired Duplex transports',
  async (major) => {
    const [a, b] = duplexPair();
    const [native, endpoint] = duplexPair();
    const client = rpcResidencyStream(a, 'client'),
      worker = rpcResidencyStream(endpoint, 'worker');
    b.pipe(worker).pipe(b);
    try {
      const first = read(client, 12);
      await write(native, hello(major));
      expect(await first).toEqual(hello(major));
      const original = request(Buffer.alloc(700, 9));
      let wireBytes = client.bytesWritten;
      const received = read(native, original.length);
      await write(client, original);
      expect(await received).toEqual(original);
      const definitionBytes = client.bytesWritten - wireBytes;
      wireBytes = client.bytesWritten;
      const again = read(native, original.length);
      await write(client, original);
      expect(await again).toEqual(original);
      expect(client.bytesWritten - wireBytes).toBeLessThan(definitionBytes);
      expect(client.residencyStats.references).toBe(1);
      const response = Buffer.from([255, 0, 14, 88]);
      const output = read(client, response.length);
      await write(native, response);
      expect(await output).toEqual(response);
      expect(client.bytesRead).toBe(16);
    } finally {
      client.destroy();
      worker.destroy();
      b.destroy();
      native.destroy();
    }
  },
);

it('unknown versions keep all future native bytes literal', async () => {
  const [a, b] = duplexPair(),
    [native, endpoint] = duplexPair();
  const client = rpcResidencyStream(a, 'client'),
    worker = rpcResidencyStream(endpoint, 'worker');
  b.pipe(worker).pipe(b);
  try {
    const h = read(client, 12);
    await write(native, hello(99));
    await h;
    const bytes = Buffer.from('future native protocol');
    const output = read(native, bytes.length);
    await write(client, bytes);
    expect(await output).toEqual(bytes);
    expect(client.residencyStats.references).toBe(0);
  } finally {
    client.destroy();
    worker.destroy();
    b.destroy();
    native.destroy();
  }
});

it('destroys the negotiated transport and releases caches when the owner closes', async () => {
  const [a, b] = duplexPair();
  const client = rpcResidencyStream(a, 'client');
  client.on('error', () => {});
  client.resume();
  await write(b, hello());
  b.resume();
  await write(client, request(Buffer.alloc(600, 1)));
  expect(client.residencyStats.cachedBytes).toBeGreaterThan(0);
  const closed = once(client, 'close');
  client.destroy();
  await closed;
  expect(a.destroyed).toBe(true);
  expect(client.residencyStats.cachedBytes).toBe(0);
  b.destroy();
});

it('propagates remote errors without replaying buffered native writes', async () => {
  const [a, b] = duplexPair();
  const client = rpcResidencyStream(a, 'client');
  const failure = once(client, 'error');
  a.destroy(Error('fixture transport loss'));
  expect((await failure)[0]).toHaveProperty('message', 'fixture transport loss');
  expect(client.destroyed).toBe(true);
  b.destroy();
});

it('rejects a truncated frame at EOF and closes the native worker stream', async () => {
  const [native, endpoint] = duplexPair();
  const worker = rpcResidencyStream(endpoint, 'worker');
  native.on('error', () => {});
  worker.resume();
  const failure = once(worker, 'error');
  worker.end(Buffer.from([1, 0]));
  expect((await failure)[0]).toHaveProperty('message', 'RPC_RESIDENCY_INVALID');
  expect(endpoint.destroyed).toBe(true);
  native.destroy();
});

it('closing a blocked transport settles the pending writer', async () => {
  const [a, b] = duplexPair({ highWaterMark: 1 });
  const client = rpcResidencyStream(a, 'client');
  client.on('error', () => {});
  const pending = write(client, request(Buffer.alloc(5 * 1024 * 1024)));
  const rejected = expect(pending).rejects.toThrow();
  client.destroy();
  await rejected;
  expect(a.destroyed).toBe(true);
  b.destroy();
});
