import { Duplex } from 'node:stream';
import { GENERATION_POLICY } from '../generation/contracts.js';
type StreamCallback = (error?: Error | null) => void;
// One full TLS record (16 KiB plus framing) must fit without serial tiny tails.
export const RPC_IPC_FRAME_BYTES = 32 * 1024;
const encodedFrameBytes = Math.ceil(RPC_IPC_FRAME_BYTES / 3) * 4;

export type RpcIpcMessage =
  | Readonly<{ type: 'rpc-data'; id: string; sequence: number; bytes: string }>
  | Readonly<{ type: 'rpc-ack'; id: string; sequence: number }>
  | Readonly<{ type: 'rpc-close'; id: string }>;
const invalid = (): never => {
  throw new Error('INVALID_RPC_CHANNEL');
};

/** Parent/core-only byte pipe. At most one 32-KiB fragment is in flight; a full
 * readable buffer withholds its acknowledgement until the consumer pulls.
 * This IPC schema is never exposed through the renderer's peer bridge. */
export function rpcIpcStream(id: string, send: (message: RpcIpcMessage) => void) {
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(id)) invalid();
  let sent = 0,
    received = 0,
    blockedAck: number | undefined,
    timer: ReturnType<typeof setTimeout> | undefined;
  let pending: { bytes: Buffer; offset: number; end: number; callback: StreamCallback } | undefined;
  const writeNext = () => {
    if (!pending) return;
    if (pending.offset === pending.bytes.length) {
      const callback = pending.callback;
      pending = undefined;
      callback();
      return;
    }
    pending.end = Math.min(pending.offset + RPC_IPC_FRAME_BYTES, pending.bytes.length);
    // Acknowledgement includes downstream native backpressure, not just IPC delivery.
    timer = setTimeout(
      () => stream.destroy(new Error('RPC_IPC_TIMEOUT')),
      GENERATION_POLICY.generationMs,
    );
    send({
      type: 'rpc-data',
      id,
      sequence: ++sent,
      bytes: pending.bytes.subarray(pending.offset, pending.end).toString('base64'),
    });
  };
  const stream = new Duplex({
    highWaterMark: RPC_IPC_FRAME_BYTES,
    read() {
      if (blockedAck !== undefined) {
        const sequence = blockedAck;
        blockedAck = undefined;
        send({ type: 'rpc-ack', id, sequence });
      }
    },
    write(bytes: Buffer, _encoding, callback) {
      if (!Buffer.isBuffer(bytes) || bytes.length > 65536 || pending) {
        callback(new Error('INVALID_RPC_CHANNEL'));
        return;
      }
      pending = { bytes, offset: 0, end: 0, callback };
      try {
        writeNext();
      } catch {
        stream.destroy(new Error('RPC_DISCONNECTED'));
      }
    },
    final(callback) {
      stream.destroy();
      callback();
    },
    destroy(error, callback) {
      clearTimeout(timer);
      const interrupted = pending;
      pending = undefined;
      if (interrupted) interrupted.callback(error ?? new Error('RPC_DISCONNECTED'));
      try {
        send({ type: 'rpc-close', id });
      } catch {
        /* The retained owner already handles channel failure. */
      }
      callback(error);
    },
  });
  // Intentional owner destruction must be safe before consumers attach listeners.
  stream.on('error', () => undefined);
  return {
    stream,
    receive(input: unknown) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) invalid();
      const message = input as Record<string, unknown>;
      const keys =
        message.type === 'rpc-data'
          ? ['type', 'id', 'sequence', 'bytes']
          : message.type === 'rpc-ack'
            ? ['type', 'id', 'sequence']
            : ['type', 'id'];
      if (
        Object.keys(message).length !== keys.length ||
        keys.some((key) => !Object.hasOwn(message, key)) ||
        message.id !== id
      )
        invalid();
      if (stream.destroyed) return;
      if (message.type === 'rpc-close') {
        stream.destroy();
        return;
      }
      if (!Number.isSafeInteger(message.sequence) || (message.sequence as number) < 1) invalid();
      if (message.type === 'rpc-ack') {
        if (!pending || message.sequence !== sent) return invalid();
        clearTimeout(timer);
        pending.offset = pending.end;
        writeNext();
        return;
      }
      if (
        message.type !== 'rpc-data' ||
        message.sequence !== received + 1 ||
        blockedAck !== undefined ||
        typeof message.bytes !== 'string' ||
        !message.bytes.length ||
        message.bytes.length > encodedFrameBytes
      )
        return invalid();
      const bytes = Buffer.from(message.bytes, 'base64');
      if (bytes.length > RPC_IPC_FRAME_BYTES || bytes.toString('base64') !== message.bytes)
        invalid();
      ++received;
      if (stream.push(bytes)) send({ type: 'rpc-ack', id, sequence: received });
      else blockedAck = received;
    },
  };
}
