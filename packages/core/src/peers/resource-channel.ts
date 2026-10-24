import { randomUUID } from 'node:crypto';
import { decodeClusterDevice } from '../cluster/device-id.js';
import { exact } from '../hosts/control.js';
import { peerDeadline } from './deadline.js';
import { decodePeerResources } from './resources.js';
import type { PeerResources } from './resources.js';

function device(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || decodeClusterDevice(value).kind !== 'peer')
    throw Error('INVALID_CONTROL');
  return value;
}
/** Parent-only resource query, absent from the renderer command schema. */
export async function servePeerResources(
  message: Record<string, unknown>,
  read: (device: string | null) => Promise<PeerResources>,
  send: (value: object) => void,
): Promise<void> {
  exact(message, ['type', 'id', 'device']);
  if (
    message.type !== 'resource-read' ||
    typeof message.id !== 'string' ||
    !/^[a-f0-9-]{36}$/u.test(message.id)
  )
    throw Error('INVALID_CONTROL');
  const target = device(message.device);
  try {
    send({ type: 'resource-result', id: message.id, ok: true, resources: await read(target) });
  } catch (error) {
    send({
      type: 'resource-result',
      id: message.id,
      ok: false,
      error:
        error instanceof Error && /^[A-Z_]{1,64}$/u.test(error.message)
          ? error.message
          : 'PEER_UNAVAILABLE',
    });
  }
}
export function peerResourceClient(send: (value: object) => void) {
  const pending = new Map<
    string,
    { resolve(value: PeerResources): void; reject(error: Error): void }
  >();
  let closed = false;
  return {
    receive(message: Record<string, unknown>) {
      exact(message, ['type', 'id', 'ok', message.ok === true ? 'resources' : 'error']);
      if (
        message.type !== 'resource-result' ||
        typeof message.id !== 'string' ||
        typeof message.ok !== 'boolean'
      )
        throw Error('INVALID_CONTROL');
      const entry = pending.get(message.id);
      if (!entry) return; // A bounded query may have already timed out.
      pending.delete(message.id);
      if (message.ok) {
        try {
          entry.resolve(decodePeerResources(message.resources));
        } catch (error) {
          entry.reject(Error('NEEDS_RESOURCE_EVIDENCE'));
          throw error;
        }
      } else if (typeof message.error === 'string' && /^[A-Z_]{1,64}$/u.test(message.error))
        entry.reject(Error(message.error));
      else throw Error('INVALID_CONTROL');
    },
    close() {
      closed = true;
      for (const entry of pending.values()) entry.reject(Error('CORE_EXITED'));
      pending.clear();
    },
    async read(target: string | null): Promise<PeerResources> {
      if (closed || pending.size >= 4) throw Error('NOT_READY');
      device(target);
      const id = randomUUID();
      const reply = new Promise<PeerResources>((resolve, reject) =>
        pending.set(id, { resolve, reject }),
      );
      try {
        send({ type: 'resource-read', id, device: target });
        return await peerDeadline(reply, 20000, 'PEER_TIMEOUT');
      } finally {
        pending.delete(id);
      }
    },
  };
}
