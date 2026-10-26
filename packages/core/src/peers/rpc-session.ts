import { Duplex } from 'node:stream';
import type { OwnedPeerRpc } from './rpc.js';
import { peerDeadline } from './deadline.js';
import { cacheRelayPayload } from '../tensor-cache/relay.js';
import type { CacheSettings } from '../tensor-cache/wire.js';

const maximumData = 262144;
function frame(kind: number, payload: Buffer = Buffer.alloc(0)): Buffer {
  const bytes = Buffer.allocUnsafe(payload.length + 5);
  bytes.writeUInt32LE(payload.length + 1);
  bytes[4] = kind;
  payload.copy(bytes, 5);
  return bytes;
}
interface Connection {
  stream: Duplex;
  ready: boolean;
  closing: boolean;
  resolve: (value: OwnedPeerRpc) => void;
  reject: (error: Error) => void;
  stopped: Promise<void>;
  confirm: () => void;
  fail: (error: Error) => void;
  close: () => Promise<void>;
}

/** One PID-bound local helper transport, with sequential restricted workers.
 * The envelope is private owner control; remote RPC bytes are always Data. */
export class RpcRelaySession {
  private pending = Buffer.alloc(0);
  private connection: Connection | undefined;
  private failed = false;
  private stopping = false;
  private closing: Promise<void> | undefined;
  constructor(private readonly helper: OwnedPeerRpc) {
    helper.stream.on('data', (chunk: Buffer) => {
      try {
        this.receive(chunk);
      } catch {
        this.fail();
      }
    });
    helper.stream.on('error', () => this.fail());
    helper.stream.on('close', () => {
      if (!this.stopping || this.connection) this.fail();
    });
  }
  private fail(): void {
    this.failed = true;
    const current = this.connection;
    if (current) {
      current.reject(new Error('RPC_UNAVAILABLE'));
      current.fail(new Error('RPC_CLEANUP_FAILED'));
      current.stream.destroy(new Error('RPC_UNAVAILABLE'));
    }
    this.helper.stream.destroy();
  }
  private send(kind: number, payload?: Buffer, callback?: (error?: Error | null) => void) {
    this.helper.stream.write(frame(kind, payload), callback);
  }
  async start(cache?: CacheSettings, owner?: string): Promise<OwnedPeerRpc> {
    const cachePolicy = cacheRelayPayload(cache, owner);
    if (this.failed || this.stopping) throw new Error('RPC_UNAVAILABLE');
    if (this.connection) throw new Error('RPC_BUSY');
    let confirm!: () => void, fail!: (error: Error) => void;
    const stopped = new Promise<void>((resolve, reject) => {
      confirm = resolve;
      fail = reject;
    });
    void stopped.catch(() => undefined);
    let current!: Connection;
    const stream = new Duplex({
      read: () => this.helper.stream.resume(),
      write: (chunk: Buffer, _encoding, callback) => {
        if (this.failed || current.closing || !current.ready) {
          callback(new Error('RPC_UNAVAILABLE'));
          return;
        }
        // The caller's chunk size does not change the native parser's bound.
        for (let offset = 0; offset < chunk.length; offset += maximumData) {
          const last = offset + maximumData >= chunk.length;
          this.send(2, chunk.subarray(offset, offset + maximumData), last ? callback : undefined);
        }
        if (!chunk.length) callback();
      },
      final: (callback) => {
        void current.close().then(() => callback(), callback);
      },
    });
    stream.on('error', () => {
      void current.close().catch(() => undefined);
    });
    stream.on('close', () => {
      void current.close().catch(() => undefined);
    });
    let close: Promise<void> | undefined;
    const opening = new Promise<OwnedPeerRpc>((resolve, reject) => {
      current = {
        stream,
        ready: false,
        closing: false,
        resolve,
        reject,
        stopped,
        confirm,
        fail,
        close: () =>
          (close ??= (async () => {
            current.closing = true;
            current.reject(new Error('RPC_UNAVAILABLE'));
            stream.destroy();
            this.helper.stream.resume();
            if (!this.failed) this.send(3);
            try {
              await peerDeadline(stopped, 10000, 'RPC_CLEANUP_FAILED');
            } catch (error) {
              this.fail();
              throw error;
            }
          })()),
      };
      this.connection = current;
      this.send(1, cachePolicy);
    });
    try {
      return await peerDeadline(opening, 20000, 'RPC_START_TIMEOUT');
    } catch (error) {
      await current.close().catch(() => undefined);
      throw error;
    }
  }
  private receive(chunk: Buffer): void {
    this.pending = Buffer.concat([this.pending, chunk]);
    while (this.pending.length >= 4) {
      const length = this.pending.readUInt32LE();
      if (!length || length > maximumData + 1) throw new Error('INVALID_RPC_FRAME');
      if (this.pending.length < length + 4) return;
      const bytes = this.pending.subarray(4, length + 4);
      this.pending = this.pending.subarray(length + 4);
      const kind = bytes[0],
        current = this.connection;
      if (!current) throw new Error('INVALID_RPC_FRAME');
      if (kind === 1 && !current.ready && bytes.length <= 4096) {
        const report: unknown = JSON.parse(bytes.subarray(1).toString('utf8'));
        if (
          !report ||
          typeof report !== 'object' ||
          Reflect.get(report, 'phase') !== 'relay-ready' ||
          Reflect.get(report, 'workerRestricted') !== true
        )
          throw new Error('INVALID_RPC_REPORT');
        const cacheError: unknown = Reflect.get(report, 'cacheError');
        if (cacheError !== undefined && cacheError !== 'CACHE_LOCATION_UNAVAILABLE')
          throw new Error('INVALID_RPC_REPORT');
        current.ready = true;
        if (!current.closing)
          current.resolve({
            stream: current.stream,
            close: current.close,
            ...(cacheError === 'CACHE_LOCATION_UNAVAILABLE' ? { cacheError } : {}),
          });
      } else if (kind === 2 && current.ready && bytes.length > 1) {
        if (!current.closing && !current.stream.push(bytes.subarray(1))) this.helper.stream.pause();
      } else if (kind === 3 && current.closing && bytes.length === 1) {
        this.connection = undefined;
        current.confirm();
      } else if (kind === 4 && current.ready && bytes.length === 1) {
        void current.close().catch(() => undefined);
      } else throw new Error('INVALID_RPC_FRAME');
    }
  }
  close(): Promise<void> {
    return (this.closing ??= (async () => {
      this.stopping = true;
      try {
        await this.connection?.close();
      } catch {
        // A lost worker receipt is superseded only by confirmed full helper cleanup.
      }
      await this.helper.close();
    })().catch((error: unknown) => {
      this.closing = undefined;
      throw error;
    }));
  }
}
