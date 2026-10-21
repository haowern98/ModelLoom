// Bounded CPU-only transport diagnostic at stock source 4f31296. No graph,
// model, disk cache, GPU allocation, or address outside its own buffer is used.
import { performance } from 'node:perf_hooks';
import { Buffer } from 'node:buffer';
import { deadline } from './diagnostic-lifecycle.mjs';

export async function runRpcByteProbe(node, id, echoOnly = false) {
  const stream = await node.openRpc(id);
  const reader = stream[Symbol.asyncIterator]();
  let buffered = Buffer.alloc(0);
  const bytes = 8 * 1048576;
  async function receive(length) {
    while (buffered.length < length) {
      const next = await reader.next();
      if (next.done) throw Error('RPC_DIAGNOSTIC_CLOSED');
      buffered = Buffer.concat([buffered, next.value]);
      if (buffered.length > bytes + 4096) throw Error('RPC_DIAGNOSTIC_LIMIT');
    }
    const result = buffered.subarray(0, length);
    buffered = buffered.subarray(length);
    return result;
  }
  function send(command, payload) {
    const header = Buffer.alloc(9);
    header[0] = command;
    header.writeBigUInt64LE(BigInt(payload.length), 1);
    stream.write(header);
    stream.write(payload);
  }
  async function response(size) {
    if ((await receive(8)).readBigUInt64LE() !== BigInt(size)) throw Error('RPC_DIAGNOSTIC_SIZE');
    return receive(size);
  }
  try {
    return await deadline(
      (async () => {
        if (echoOnly) {
          const expected = Buffer.alloc(bytes, 90);
          const started = performance.now();
          stream.write(expected);
          if (!(await receive(bytes)).equals(expected)) throw Error('RPC_DIAGNOSTIC_BYTES_CHANGED');
          return {
            passed: true,
            gpuUsed: false,
            exactBytes: bytes,
            roundTripMs: Math.round(performance.now() - started),
          };
        }
        send(14, Buffer.alloc(24));
        const hello = await response(28);
        if (hello[0] !== 7 || hello[1] || hello[2]) throw Error('RPC_DIAGNOSTIC_VERSION');
        const allocation = Buffer.alloc(12);
        allocation.writeBigUInt64LE(BigInt(bytes), 4);
        send(0, allocation);
        const allocated = await response(16);
        const buffer = allocated.readBigUInt64LE();
        if (!buffer || allocated.readBigUInt64LE(8) < BigInt(bytes))
          throw Error('RPC_DIAGNOSTIC_ALLOCATION');
        const pointer = Buffer.alloc(8);
        pointer.writeBigUInt64LE(buffer);
        send(3, pointer);
        const base = (await response(8)).readBigUInt64LE();
        // Packed rpc_tensor is 296 bytes at this pin: F32, one contiguous dimension.
        const tensor = Buffer.alloc(296);
        tensor.writeBigUInt64LE(1n);
        tensor.writeBigUInt64LE(buffer, 12);
        [bytes / 4, 1, 1, 1].forEach((n, i) => tensor.writeUInt32LE(n, 20 + i * 4));
        [4, bytes, bytes, bytes].forEach((n, i) => tensor.writeUInt32LE(n, 36 + i * 4));
        tensor.writeBigUInt64LE(base, 220);
        tensor.write('ModelLoom CPU byte fixture', 228, 'ascii');
        const expected = Buffer.alloc(bytes, 90);
        const started = performance.now();
        send(6, Buffer.concat([tensor, Buffer.alloc(9), expected]));
        const get = Buffer.concat([tensor, Buffer.alloc(16)]);
        get.writeBigUInt64LE(BigInt(bytes), 304);
        send(8, get);
        const actual = await response(bytes);
        if (!actual.equals(expected)) throw Error('RPC_DIAGNOSTIC_BYTES_CHANGED');
        send(4, pointer);
        return {
          passed: true,
          gpuUsed: false,
          exactBytes: bytes,
          roundTripMs: Math.round(performance.now() - started),
        };
      })(),
      45000,
      'RPC_DIAGNOSTIC_TIMEOUT',
    );
  } finally {
    stream.destroy();
  }
}
