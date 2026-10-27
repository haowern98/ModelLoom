import { expect, it } from 'vitest';
import {
  RpcResidencyEncoder,
  RpcResidencyDecoder,
  residencyLiteral,
} from './rpc-residency-protocol.js';

function hello(major: number): Buffer {
  const b = Buffer.alloc(12);
  b.writeBigUInt64LE(4n);
  b[8] = major;
  return b;
}
function request(payload: Buffer, command = 6): Buffer {
  const b = Buffer.alloc(9);
  b[0] = command;
  b.writeBigUInt64LE(BigInt(payload.length), 1);
  return Buffer.concat([b, payload]);
}
function fixture(major = 8) {
  const encoder = new RpcResidencyEncoder();
  const decoder = new RpcResidencyDecoder();
  encoder.observeReply(hello(major));
  decoder.observeReply(hello(major));
  const wire: Buffer[] = [],
    restored: Buffer[] = [];
  async function send(bytes: Buffer, fragmented = false) {
    const emit = async (b: Buffer) => {
      wire.push(Buffer.from(b));
      if (fragmented) {
        for (const byte of b)
          await decoder.write(Buffer.from([byte]), (b) => {
            restored.push(Buffer.from(b));
            return Promise.resolve();
          });
      } else
        await decoder.write(b, (b) => {
          restored.push(Buffer.from(b));
          return Promise.resolve();
        });
    };
    if (fragmented) {
      for (const byte of bytes) await encoder.write(Buffer.from([byte]), emit);
    } else await encoder.write(bytes, emit);
  }
  return { encoder, decoder, wire, restored, send };
}

it.each([6, 7, 8])(
  'reconstructs every original protocol %i SET after graph/overlap/shape changes',
  async (major) => {
    const f = fixture(major);
    const original = request(Buffer.alloc(600, 4));
    const changed = Buffer.from(original);
    changed[40] = 7;
    const graph = request(Buffer.alloc(4), 16);
    await f.send(original);
    await f.send(graph);
    await f.send(changed);
    await f.send(original);
    expect(Buffer.concat(f.restored)).toEqual(Buffer.concat([original, graph, changed, original]));
    expect(f.encoder.stats.references).toBe(1);
    expect(f.decoder.stats).toHaveProperty('references', 1);
    expect(f.wire.at(-1)?.length).toBeLessThan(20);
  },
);

it('handles fragmented native and private headers without retaining caller buffers', async () => {
  const f = fixture();
  const original = request(Buffer.alloc(600, 9));
  await f.send(original, true);
  original.fill(0);
  await f.send(request(Buffer.alloc(600, 9)), true);
  expect(Buffer.concat(f.restored)).toEqual(
    Buffer.concat([request(Buffer.alloc(600, 9)), request(Buffer.alloc(600, 9))]),
  );
  expect(f.encoder.stats.references).toBe(1);
  f.encoder.finish();
  f.decoder.finish();
});

it('streams large model writes literally in bounded chunks rather than buffering the whole tensor', async () => {
  const f = fixture();
  const bytes = request(Buffer.alloc(5 * 1024 * 1024, 7));
  await f.send(bytes);
  expect(Buffer.concat(f.restored).equals(bytes)).toBe(true);
  expect(Math.max(...f.wire.map((b) => b.length))).toBeLessThanOrEqual(65536 + 9);
  expect(f.encoder.stats.cachedBytes).toBe(0);
});

it('uses literal transport for unknown native versions, with no tensor-layout assumptions', async () => {
  const f = fixture(99);
  const bytes = Buffer.from('opaque future runtime protocol');
  await f.send(bytes);
  await f.send(bytes);
  expect(Buffer.concat(f.restored)).toEqual(Buffer.concat([bytes, bytes]));
  expect(f.encoder.stats.references).toBe(0);
});

it('rejects missing references and definitions before a supported native HELLO', async () => {
  const decoder = new RpcResidencyDecoder();
  const ref = Buffer.alloc(9);
  ref[0] = 2;
  ref.writeUInt32LE(1, 1);
  await expect(decoder.write(ref, async () => {})).rejects.toThrow('RPC_RESIDENCY');
  const f = fixture();
  await f.send(request(Buffer.alloc(600, 1)));
  await expect(new RpcResidencyDecoder().write(f.wire[0]!, async () => {})).rejects.toThrow(
    'RPC_RESIDENCY',
  );
});

it('rejects truncated EOF and malformed private bounds', async () => {
  const f = fixture();
  await f.encoder.write(Buffer.from([6, 1]), async () => {});
  expect(() => f.encoder.finish()).toThrow('RPC_RESIDENCY');
  await f.decoder.write(Buffer.from([0, 0]), async () => {});
  expect(() => f.decoder.finish()).toThrow('RPC_RESIDENCY');
  const header = Buffer.alloc(9);
  header[0] = 0;
  header.writeUInt32LE(65537, 5);
  await expect(fixture().decoder.write(header, async () => {})).rejects.toThrow('RPC_RESIDENCY');
});

it('streams uint64-sized native requests without allocating their advertised length', async () => {
  const f = fixture();
  const header = Buffer.alloc(9);
  header[0] = 6;
  header.writeBigUInt64LE(0xffffffffffffffffn, 1);
  await f.send(header);
  await f.send(Buffer.alloc(4096, 7));
  expect(Buffer.concat(f.restored)).toEqual(Buffer.concat([header, Buffer.alloc(4096, 7)]));
  expect(f.encoder.stats.cachedBytes).toBe(0);
  expect(() => f.encoder.finish()).toThrow('RPC_RESIDENCY');
});

it('bounds dictionary entries and releases all cached bytes on close or reconnect', async () => {
  const f = fixture();
  for (let i = 0; i < 4100; i++) {
    const b = Buffer.alloc(512);
    b.writeUInt32LE(i);
    await f.send(request(b));
  }
  expect(f.encoder.stats.entries).toBeLessThanOrEqual(4096);
  expect(f.decoder.stats.entries).toBeLessThanOrEqual(4096);
  const b = Buffer.alloc(512);
  await f.send(request(b));
  expect(f.wire.at(-1)?.[0]).toBe(1);
  f.encoder.clear();
  f.decoder.clear();
  expect(f.encoder.stats.cachedBytes).toBe(0);
  expect(f.decoder.stats.cachedBytes).toBe(0);
  const fresh = fixture();
  await fresh.send(request(b));
  expect(fresh.encoder.stats.references).toBe(0);
});

it('awaits a slow consumer before emitting more private frames', async () => {
  const encoder = new RpcResidencyEncoder();
  encoder.observeReply(hello(8));
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  let frames = 0;
  const pending = encoder.write(request(Buffer.alloc(5 * 1024 * 1024)), async () => {
    frames++;
    await blocked;
  });
  await Promise.resolve();
  expect(frames).toBe(1);
  release();
  await pending;
  expect(frames).toBeGreaterThan(1);
  expect(residencyLiteral(Buffer.from('x'))[0]).toBe(0);
});
