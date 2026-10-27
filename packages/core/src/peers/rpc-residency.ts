import { Duplex } from 'node:stream';
import { RpcResidencyEncoder, RpcResidencyDecoder } from './rpc-residency-protocol.js';

export const RPC_RESIDENCY_HEADER = 'x-modelloom-rpc-residency';
export const RPC_RESIDENCY_VERSION = 'input-residency/1';
type Role = 'client' | 'worker';

function writeTo(transport: Duplex, bytes: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    if (transport.destroyed || !transport.writable) {
      reject(Error('RPC_DISCONNECTED'));
      return;
    }
    let settled = false;
    const finish = (error?: Error | null) => {
      if (settled) return;
      settled = true;
      transport.off('close', closed);
      transport.off('error', finish);
      if (error) reject(error);
      else resolve();
    };
    const closed = () => finish(Error('RPC_DISCONNECTED'));
    transport.once('close', closed);
    transport.once('error', finish);
    transport.write(bytes, finish);
  });
}

class RpcResidencyStream extends Duplex {
  private readonly encoder = new RpcResidencyEncoder();
  private readonly decoder = new RpcResidencyDecoder();
  private sent = 0;
  private received = 0;
  constructor(
    private readonly transport: Duplex,
    private readonly role: Role,
  ) {
    super({ allowHalfOpen: false, readableHighWaterMark: 262144, writableHighWaterMark: 262144 });
    transport.on('data', (bytes: Buffer) => {
      if (this.destroyed) return;
      // Observe the native HELLO before exposing its bytes; numerical responses
      // themselves remain opaque and are never cached or synthesized here.
      this.encoder.observeReply(bytes);
      this.decoder.observeReply(bytes);
      this.received += bytes.length;
      if (!this.push(bytes)) transport.pause();
    });
    transport.pause();
    transport.once('end', () => this.push(null));
    transport.once('error', (error: Error) => this.destroy(error));
    transport.once('close', () => {
      if (!this.destroyed) this.destroy();
    });
  }
  /** Actual private-transport counts on the client, preserving peer traffic accounting. */
  get bytesWritten(): number {
    return this.sent;
  }
  get bytesRead(): number {
    return this.received;
  }
  get residencyStats() {
    return this.role === 'client' ? this.encoder.stats : this.decoder.stats;
  }
  override _read(): void {
    this.transport.resume();
  }
  override _write(
    bytes: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    const codec = this.role === 'client' ? this.encoder : this.decoder;
    void codec
      .write(bytes, async (output) => {
        await writeTo(this.transport, output);
        this.sent += output.length;
      })
      .then(
        () => callback(),
        (error: unknown) =>
          callback(error instanceof Error ? error : Error('RPC_RESIDENCY_INVALID')),
      );
  }
  override _final(callback: (error?: Error | null) => void): void {
    try {
      if (this.role === 'client') this.encoder.finish();
      else this.decoder.finish();
      this.transport.end(callback);
    } catch (error) {
      callback(error instanceof Error ? error : Error('RPC_RESIDENCY_INVALID'));
    }
  }
  override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    this.encoder.clear();
    this.decoder.clear();
    this.transport.destroy();
    callback(error);
  }
}

/** Wrap an already authorized transport, after exact HTTP capability negotiation.
 * Client presents ordinary native RPC; worker presents the private data codec.
 * Owning code must still close its verified native worker and reservation. A
 * wrapper close destroys the underlying transport and releases all cached bytes.
 * No listeners, credentials, helper-control commands or native binaries are added. */
export function rpcResidencyStream(transport: Duplex, role: Role): RpcResidencyStream {
  return new RpcResidencyStream(transport, role);
}
