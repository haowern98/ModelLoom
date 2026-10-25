import { Duplex } from 'node:stream';
import type { Readable, Writable } from 'node:stream';
import type { EventEmitter } from 'node:events';
import type { NetworkStore } from './store.js';
import { validateLoginUrl, decodeNetworkView } from './wire.js';
import type { NetworkView } from './wire.js';

export interface HelperProcess extends EventEmitter {
  readonly stdin: Writable;
  readonly stdout: Readable;
  readonly stderr: Readable;
  kill(): boolean;
}
export interface TailnetPeer {
  readonly id: string;
  readonly address: string;
  readonly name: string;
  readonly online: boolean;
}
export interface HelperEvents {
  status(view: NetworkView, peers: readonly TailnetPeer[]): void;
  login(url: string): void;
  incoming(port: number, stream: Duplex): void;
  lost(): void;
}
interface Pipe {
  duplex: Duplex;
  sequence: number;
  received: number;
  acknowledge?: () => void;
  write?: { callback(error?: Error | null): void; timer: ReturnType<typeof setTimeout> };
}
const maximum = 131072,
  chunk = 32768;
const error = () => Error('NETWORK_COMPONENT_FAILED');
function integer(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) throw error();
  return value as number;
}
function text(value: unknown, max = 255): string {
  if (
    typeof value !== 'string' ||
    !value.length ||
    value.length > max ||
    [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
  )
    throw error();
  return value;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw error();
  return value as Record<string, unknown>;
}
function frame(raw: string): Record<string, unknown> {
  const value = object(JSON.parse(raw));
  const keys = new Set<string>();
  let depth = 0;
  for (let index = 0; index < raw.length; index++) {
    const character = raw[index];
    if (character === '"') {
      const start = index++;
      for (; index < raw.length; index++) {
        if (raw[index] === '\\') index++;
        else if (raw[index] === '"') break;
      }
      let after = index + 1;
      while (/\s/u.test(raw[after] ?? '') && after < raw.length) after++;
      if (depth === 1 && raw[after] === ':') {
        const key = JSON.parse(raw.slice(start, index + 1)) as string;
        if (keys.has(key)) throw error();
        keys.add(key);
      }
    } else if (character === '{' || character === '[') depth++;
    else if (character === '}' || character === ']') depth--;
  }
  return value;
}

/** Private inherited-pipe channel. No management operation is exported to the renderer. */
export class TailscaleHelper {
  private sequence = 0;
  private buffer = Buffer.alloc(0);
  private closed = false;
  private readonly pending = new Map<
    number,
    { resolve(): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }
  >();
  private readonly vaultPending = new Map<
    number,
    {
      resolve(value: Record<string, unknown>): void;
      reject(error: Error): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private readonly streams = new Map<string, Pipe>();
  private queued = 0;
  private writes = Promise.resolve();
  private readonly retired = new Set<string>();
  private lastIncoming = 0;
  private lastStore = 0;
  private peerBatch: { id: number; peers: unknown[] } | undefined;
  private readyResolve!: () => void;
  private readyReject!: (error: Error) => void;
  private readonly preparation: Promise<void>;
  constructor(
    private readonly child: HelperProcess,
    private readonly store: Pick<NetworkStore, 'read' | 'write'>,
    private readonly events: HelperEvents,
  ) {
    this.preparation = new Promise((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    void this.preparation.catch(() => undefined);
    child.stdout.on('data', (bytes: Buffer) => {
      try {
        this.buffer = Buffer.concat([this.buffer, bytes]);
        let end: number;
        while ((end = this.buffer.indexOf(10)) >= 0) {
          if (end > maximum) throw error();
          const value = frame(this.buffer.subarray(0, end).toString());
          this.buffer = this.buffer.subarray(end + 1);
          this.receive(object(value));
        }
        if (this.buffer.length > maximum) throw error();
      } catch {
        this.fail();
      }
    });
    child.stdout.on('error', () => this.fail());
    child.stdin.on('error', () => this.fail());
    // Never persist arbitrary dependency stderr; it can include credentials or auth URLs.
    child.stderr.resume();
    child.on('error', () => this.fail());
    child.on('exit', () => this.fail());
  }
  ready(): Promise<void> {
    return this.preparation;
  }
  private send(value: object): Promise<void> {
    if (this.closed || this.queued >= 128) return Promise.reject(error());
    const frame = JSON.stringify(value) + '\n';
    if (Buffer.byteLength(frame) > maximum) return Promise.reject(error());
    ++this.queued;
    const next = this.writes
      .then(
        () =>
          new Promise<void>((resolve, reject) => {
            if (this.closed) {
              reject(error());
              return;
            }
            this.child.stdin.write(frame, (err) => (err ? reject(err) : resolve()));
          }),
      )
      .finally(() => {
        --this.queued;
      });
    this.writes = next.catch(() => this.fail());
    return next;
  }
  private request(value: object): Promise<void> {
    if (this.closed || this.pending.size >= 32) return Promise.reject(error());
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Error('NETWORK_TIMEOUT'));
      }, 20000);
      this.pending.set(id, { resolve, reject, timer });
      void this.send({ ...value, id }).catch(() => this.fail());
    });
  }
  command(
    action: 'connect' | 'disconnect' | 'sign-out' | 'status' | 'listen' | 'unlisten',
  ): Promise<void> {
    return this.request({ type: 'command', action });
  }
  private vault(action: string, seq?: number, data?: Buffer): Promise<Record<string, unknown>> {
    if (this.closed || this.vaultPending.size >= 2) return Promise.reject(error());
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.vaultPending.delete(id);
        reject(Error('NETWORK_STORAGE_UNAVAILABLE'));
      }, 20000);
      this.vaultPending.set(id, { resolve, reject, timer });
      void this.send({
        type: 'vault',
        id,
        action,
        ...(seq !== undefined ? { seq } : {}),
        ...(data ? { data: data.toString('base64') } : {}),
      }).catch(() => this.fail());
    });
  }
  async readCiphertext(): Promise<Buffer | undefined> {
    const chunks: Buffer[] = [];
    let length = 0;
    for (let seq = 0; seq <= 256; seq++) {
      const value = await this.vault('read', seq);
      if (value.found !== true) {
        if (seq !== 0) throw error();
        return undefined;
      }
      if ((value.seq ?? 0) !== seq) throw error();
      const bytes = this.bytes(value.data ?? '', chunk);
      if (!bytes.length) return Buffer.concat(chunks);
      length += bytes.length;
      if (length > 8 * 1024 * 1024) throw error();
      chunks.push(bytes);
    }
    throw error();
  }
  async replaceCiphertext(bytes: Buffer): Promise<void> {
    if (!bytes.length || bytes.length > 8 * 1024 * 1024) throw error();
    await this.vault('begin');
    for (let offset = 0, seq = 1; offset < bytes.length; offset += chunk, seq++)
      await this.vault('append', seq, bytes.subarray(offset, offset + chunk));
    await this.vault('commit');
  }
  async dial(address: string, port: number, signal?: AbortSignal): Promise<Duplex> {
    if (signal?.aborted || ![49301, 49302].includes(port)) throw Error('NETWORK_ROUTE_UNAVAILABLE');
    const id = `h-${this.sequence + 1}`,
      pipe = this.pipe(id);
    const abort = () => pipe.destroy();
    signal?.addEventListener('abort', abort, { once: true });
    pipe.once('close', () => signal?.removeEventListener('abort', abort));
    try {
      await this.request({ type: 'dial', stream: id, address, port });
      if (signal?.aborted || pipe.destroyed) throw error();
      return pipe;
    } catch (reason) {
      pipe.destroy();
      throw reason;
    }
  }
  private pipe(id: string): Duplex {
    if (!/^[gh]-[1-9][0-9]{0,15}$/u.test(id) || this.streams.has(id) || this.streams.size >= 64)
      throw error();
    const state: Pipe = { sequence: 0, received: 0, duplex: undefined as unknown as Duplex };
    const stream = new Duplex({
      highWaterMark: chunk,
      read: () => {
        state.acknowledge?.();
        delete state.acknowledge;
      },
      write: (data: Buffer, _encoding, callback) => {
        let offset = 0;
        const next = () => {
          if (offset >= data.length) {
            callback();
            return;
          }
          const bytes = data.subarray(offset, offset + chunk);
          offset += bytes.length;
          const sequence = ++state.sequence;
          state.write = {
            callback: (err) => {
              if (err) callback(err);
              else next();
            },
            timer: setTimeout(() => stream.destroy(Error('NETWORK_STREAM_TIMEOUT')), 60000),
          };
          void this.send({
            type: 'data',
            stream: id,
            seq: sequence,
            data: bytes.toString('base64'),
          }).catch(() => stream.destroy(error()));
        };
        next();
      },
      destroy: (reason, callback) => {
        const pending = state.write;
        delete state.write;
        if (pending) {
          clearTimeout(pending.timer);
          pending.callback(reason ?? error());
        }
        this.streams.delete(id);
        this.retired.add(id);
        if (this.retired.size > 256) this.retired.delete(this.retired.values().next().value!);
        if (!this.closed) void this.send({ type: 'close', stream: id }).catch(() => this.fail());
        callback(reason);
      },
    });
    state.duplex = stream;
    stream.on('error', () => undefined);
    this.streams.set(id, state);
    return stream;
  }
  private receive(value: Record<string, unknown>): void {
    if (this.closed) return;
    const type = text(value.type, 32);
    const fields: Record<string, readonly string[]> = {
      ready: ['type'],
      result: ['type', 'id', 'error'],
      'store-read': ['type', 'id', 'key'],
      'store-write': ['type', 'id', 'key', 'found', 'data'],
      login: ['type', 'url'],
      status: ['type', 'id', 'state', 'account', 'tailnet', 'addresses', 'peers'],
      incoming: ['type', 'stream', 'port'],
      data: ['type', 'stream', 'seq', 'data'],
      ack: ['type', 'stream', 'seq'],
      close: ['type', 'stream'],
      'peer-batch': ['type', 'id', 'action', 'peers'],
      'vault-result': ['type', 'id', 'found', 'seq', 'data', 'error'],
    };
    if (!fields[type] || Object.keys(value).some((key) => !fields[type]!.includes(key)))
      throw error();
    if (type === 'ready') {
      this.readyResolve();
      return;
    }
    if (type === 'vault-result') {
      const id = integer(value.id),
        pending = this.vaultPending.get(id);
      if (!pending) throw error();
      clearTimeout(pending.timer);
      this.vaultPending.delete(id);
      if (value.error) pending.reject(Error('NETWORK_STORAGE_UNAVAILABLE'));
      else pending.resolve(value);
      return;
    }
    if (type === 'result') {
      const id = integer(value.id),
        pending = this.pending.get(id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(id);
      if (value.error) pending.reject(Error(text(value.error, 64)));
      else pending.resolve();
      return;
    }
    if (type === 'store-read' || type === 'store-write') {
      const id = integer(value.id),
        key = text(value.key, 256);
      if (id <= this.lastStore || key.startsWith('modelloom:')) throw error();
      this.lastStore = id;
      const work =
        type === 'store-read'
          ? this.store.read(key)
          : this.store
              .write(
                key,
                value.found === true ? this.bytes(value.data, 4 * 1024 * 1024) : undefined,
              )
              .then(() => undefined);
      void work
        .then(
          (data) =>
            this.send({
              type: 'store-result',
              id,
              found: data !== undefined,
              ...(data ? { data: data.toString('base64') } : {}),
            }),
          () => this.send({ type: 'store-result', id, error: 'NETWORK_STORAGE_UNAVAILABLE' }),
        )
        .catch(() => this.fail());
      return;
    }
    if (type === 'login') {
      this.events.login(validateLoginUrl(value.url));
      return;
    }
    if (type === 'peer-batch') {
      const id = integer(value.id);
      if (value.action === 'begin' && !this.peerBatch && value.peers === undefined)
        this.peerBatch = { id, peers: [] };
      else if (
        value.action === 'append' &&
        this.peerBatch?.id === id &&
        Array.isArray(value.peers) &&
        value.peers.length <= 256 &&
        this.peerBatch.peers.length + value.peers.length <= 10000
      )
        this.peerBatch.peers.push(...(value.peers as unknown[]));
      else throw error();
      return;
    }
    if (type === 'status') {
      if (value.id !== undefined) {
        if (this.peerBatch?.id !== integer(value.id) || value.peers !== undefined) throw error();
        value.peers = this.peerBatch.peers;
        this.peerBatch = undefined;
      } else if (this.peerBatch) throw error();
      const view = decodeNetworkView({
        state: value.state,
        addresses: value.addresses ?? [],
        candidates: [],
        ...(value.account ? { account: value.account } : {}),
        ...(value.tailnet ? { tailnet: value.tailnet } : {}),
      });
      if (value.peers !== undefined && (!Array.isArray(value.peers) || value.peers.length > 10000))
        throw error();
      const peers = ((value.peers ?? []) as unknown[]).map((input) => {
        const peer = object(input);
        if (typeof peer.online !== 'boolean') throw error();
        return {
          id: text(peer.id, 160),
          address: text(peer.address),
          name: text(peer.name, 80),
          online: peer.online,
        };
      });
      const paths = ((value.peers ?? []) as unknown[]).map((input) => {
        const peer = object(input);
        return {
          address: peer.address,
          path: peer.path ?? 'unknown',
          ...(peer.observedAt !== undefined ? { observedAt: peer.observedAt } : {}),
        };
      });
      this.events.status(
        decodeNetworkView({ ...view, paths: view.state === 'connected' ? paths : [] }),
        peers,
      );
      return;
    }
    if (type === 'incoming') {
      const id = text(value.stream);
      const index = Number(id.slice(2));
      if (
        !/^g-[1-9][0-9]*$/u.test(id) ||
        !Number.isSafeInteger(index) ||
        index <= this.lastIncoming ||
        ![49301, 49302].includes(Number(value.port))
      )
        throw error();
      this.lastIncoming = index;
      this.events.incoming(Number(value.port), this.pipe(id));
      return;
    }
    const id = text(value.stream),
      pipe = this.streams.get(id);
    if (!pipe) {
      if (this.retired.has(id)) return;
      throw error();
    }
    if (type === 'close') {
      pipe.duplex.destroy();
      return;
    }
    if (type === 'ack') {
      if (!pipe.write || integer(value.seq) !== pipe.sequence) throw error();
      const pending = pipe.write;
      delete pipe.write;
      clearTimeout(pending.timer);
      pending.callback();
      return;
    }
    if (type === 'data') {
      const seq = integer(value.seq);
      if (seq !== ++pipe.received || pipe.acknowledge) throw error();
      const ack = () => {
        void this.send({ type: 'ack', stream: id, seq }).catch(() => this.fail());
      };
      if (pipe.duplex.push(this.bytes(value.data, chunk))) ack();
      else pipe.acknowledge = ack;
      return;
    }
    throw error();
  }
  private bytes(value: unknown, limit: number): Buffer {
    if (typeof value !== 'string' || value.length > Math.ceil(limit / 3) * 4) throw error();
    const bytes = Buffer.from(value, 'base64');
    if (bytes.length > limit || bytes.toString('base64') !== value) throw error();
    return bytes;
  }
  private fail(): void {
    if (this.closed) return;
    this.closed = true;
    this.readyReject(error());
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error());
    }
    this.pending.clear();
    for (const pipe of this.streams.values()) pipe.duplex.destroy();
    this.streams.clear();
    for (const pending of this.vaultPending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error());
    }
    this.vaultPending.clear();
    this.child.stdin.end();
    this.child.kill();
    this.events.lost();
  }
  async close(): Promise<void> {
    if (!this.closed) this.fail();
    await this.writes;
  }
}
