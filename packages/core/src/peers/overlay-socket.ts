import type { Duplex } from 'node:stream';
import type { Socket } from 'node:net';
const overlayStreams = new WeakSet<Duplex>();
export function isOverlaySocket(stream: Duplex): boolean {
  return overlayStreams.has(stream);
}

/** Node HTTP/TLS accept arbitrary duplex streams, but call the socket timing API.
 * Supply that API without inventing an OS address, port or process identity. */
export function overlaySocket(stream: Duplex): Socket {
  overlayStreams.add(stream);
  if (typeof Reflect.get(stream, 'setTimeout') === 'function') return stream as Socket;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const socket = Object.assign(stream, {
    setTimeout(milliseconds: number, listener?: () => void) {
      clearTimeout(timer);
      if (listener) stream.once('timeout', listener);
      if (milliseconds > 0) timer = setTimeout(() => stream.emit('timeout'), milliseconds);
      return socket;
    },
    setNoDelay() {
      return socket;
    },
    setKeepAlive() {
      return socket;
    },
    ref() {
      return socket;
    },
    unref() {
      return socket;
    },
    destroySoon() {
      stream.end();
    },
  });
  stream.once('close', () => clearTimeout(timer));
  return socket as Socket;
}
