import { randomUUID } from 'node:crypto';
import { Duplex, Writable } from 'node:stream';
import { exact } from '../hosts/control.js';
import { rpcIpcStream } from './ipc-rpc.js';
import { privatePeerHost } from './wire.js';
import type { PeerOverlay, PeerOverlayTransport } from './overlay.js';

const validPort = (port: unknown): port is number => port === 49301 || port === 49302;
function invalid(): never {
  throw Error('INVALID_CONTROL');
}
function routes(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length > 10000 ||
    value.some((v) => typeof v !== 'string' || !privatePeerHost(v))
  )
    invalid();
  if (new Set(value).size !== value.length) invalid();
  return value
    .map((entry: unknown) => {
      if (typeof entry !== 'string') invalid();
      return entry;
    })
    .sort();
}

/** Bounded byte channels on the retained parent/utility IPC connection only. */
export function overlayChannel(send: (value: object) => void) {
  const streams = new Map<
    string,
    {
      pipe: ReturnType<typeof rpcIpcStream>;
      abort: AbortController;
      resolve(): void;
      reject(error: Error): void;
      address?: string;
    }
  >();
  const settled = new Set<string>();
  // Remember ownership after route loss so callers cannot silently fall back to
  // an OS-installed VPN connection at the same address.
  const claimed = new Set<string>();
  let addresses: string[] = [],
    closed = false;
  let overlay: PeerOverlay | undefined;
  let incoming: ((port: number, stream: Duplex) => void) | undefined;
  let unsubscribers: (() => void)[] = [];
  const clear = () => {
    for (const entry of streams.values()) entry.pipe.stream.destroy();
  };
  function updateRoutes(next: string[]) {
    if (new Set([...claimed, ...next]).size > 10000) {
      clear();
      addresses = [];
      invalid();
    }
    for (const address of next) claimed.add(address);
    for (const entry of streams.values()) {
      if (next.length === 0 || (entry.address && !next.includes(entry.address)))
        entry.pipe.stream.destroy();
    }
    addresses = next;
  }
  function create(id: string, address?: string) {
    if (closed || streams.size >= 64 || streams.has(id) || settled.has(id)) invalid();
    const channel = rpcIpcStream(id, (message) => {
      if (!closed) send({ ...message, type: message.type.replace('rpc-', 'overlay-') });
    });
    // TLS can coalesce several records into a write larger than the IPC input
    // bound. Fragment before that boundary; keep its frame limits unchanged.
    const stream = Duplex.from({
      readable: channel.stream,
      writable: new Writable({
        write(bytes: Buffer, _encoding, callback) {
          let offset = 0;
          const next = (error?: Error | null) => {
            if (error || offset === bytes.length) {
              callback(error);
              return;
            }
            const part = bytes.subarray(offset, offset + 65536);
            offset += part.length;
            channel.stream.write(part, next);
          };
          next();
        },
        final(callback) {
          channel.stream.end(callback);
        },
        destroy(error, callback) {
          channel.stream.destroy(error ?? undefined);
          callback(error);
        },
      }),
    });
    stream.on('error', () => undefined);
    channel.stream.once('close', () => stream.destroy());
    stream.once('close', () => channel.stream.destroy());
    const pipe = { stream, receive: (message: unknown) => channel.receive(message) };
    const abort = new AbortController();
    let resolve!: () => void, reject!: (error: Error) => void;
    const ready = new Promise<void>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    void ready.catch(() => undefined);
    streams.set(id, { pipe, abort, resolve, reject, ...(address ? { address } : {}) });
    pipe.stream.once('close', () => {
      abort.abort();
      reject(Error('OVERLAY_DISCONNECTED'));
      streams.delete(id);
      settled.add(id);
      if (settled.size > 256) settled.delete(settled.values().next().value!);
    });
    return { pipe, abort, ready };
  }
  function connect(pipe: Duplex, remote: Duplex) {
    if (closed || pipe.destroyed) {
      remote.destroy();
      return;
    }
    pipe.once('close', () => remote.destroy());
    remote.once('error', () => pipe.destroy());
    remote.once('close', () => pipe.destroy());
    remote.pipe(pipe);
    pipe.pipe(remote);
  }
  const transport: PeerOverlayTransport = {
    has: (address) => claimed.has(address),
    async dial(address, port, signal) {
      if (!addresses.includes(address) || !validPort(port) || signal?.aborted)
        throw Error('OVERLAY_UNAVAILABLE');
      const id = randomUUID(),
        entry = create(id, address);
      const cancel = () => entry.pipe.stream.destroy();
      signal?.addEventListener('abort', cancel, { once: true });
      const timer = setTimeout(cancel, 10000);
      try {
        send({ type: 'overlay-dial', id, address, port });
        await entry.ready;
        return entry.pipe.stream;
      } catch (error) {
        entry.pipe.stream.destroy();
        throw error;
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
      }
    },
  };
  return {
    transport,
    attach(source: PeerOverlay) {
      if (overlay || closed) invalid();
      overlay = source;
      const update = () => {
        const next = routes(source.addresses());
        updateRoutes(next);
        send({ type: 'overlay-routes', addresses });
      };
      unsubscribers = [
        source.subscribe(update),
        source.incoming((port, remote) => {
          if (!validPort(port) || closed || streams.size >= 64) {
            remote.destroy();
            return;
          }
          const id = randomUUID(),
            entry = create(id);
          send({ type: 'overlay-incoming', id, port });
          connect(entry.pipe.stream, remote);
        }),
      ];
      update();
    },
    incoming(listener: (port: number, stream: Duplex) => void) {
      incoming = listener;
    },
    receive(message: Record<string, unknown>): boolean {
      if (typeof message.type !== 'string' || !message.type.startsWith('overlay-')) return false;
      if (closed) invalid();
      if (message.type === 'overlay-routes') {
        exact(message, ['type', 'addresses']);
        if (overlay) invalid();
        const next = routes(message.addresses);
        updateRoutes(next);
        return true;
      }
      if (typeof message.id !== 'string') invalid();
      const id = message.id;
      if (message.type === 'overlay-dial') {
        exact(message, ['type', 'id', 'address', 'port']);
        if (
          !overlay ||
          typeof message.address !== 'string' ||
          !addresses.includes(message.address) ||
          !validPort(message.port)
        )
          invalid();
        const entry = create(id, message.address);
        void overlay
          .dial(message.address, message.port, entry.abort.signal)
          .then((remote) => {
            if (closed || entry.pipe.stream.destroyed) {
              remote.destroy();
              return;
            }
            send({ type: 'overlay-ready', id });
            connect(entry.pipe.stream, remote);
          })
          .catch(() => {
            if (!closed) send({ type: 'overlay-error', id });
            entry.pipe.stream.destroy();
          });
      } else if (message.type === 'overlay-incoming') {
        exact(message, ['type', 'id', 'port']);
        if (overlay || !incoming || !validPort(message.port)) invalid();
        const entry = create(id);
        incoming(message.port, entry.pipe.stream);
      } else {
        const entry = streams.get(id);
        if (!entry) {
          if (message.type === 'overlay-close' || settled.has(id)) return true;
          invalid();
        }
        if (message.type === 'overlay-ready' || message.type === 'overlay-error') {
          exact(message, ['type', 'id']);
          if (message.type === 'overlay-ready') entry.resolve();
          else {
            entry.reject(Error('OVERLAY_UNAVAILABLE'));
            entry.pipe.stream.destroy();
          }
        } else entry.pipe.receive({ ...message, type: message.type.replace('overlay-', 'rpc-') });
      }
      return true;
    },
    close() {
      if (closed) return;
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      unsubscribers = [];
      clear();
      closed = true;
    },
  };
}
