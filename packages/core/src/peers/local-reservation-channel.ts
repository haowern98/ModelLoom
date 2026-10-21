import { randomUUID } from 'node:crypto';
import { peerDeadline } from './deadline.js';
import { decodeClusterDevice } from '../cluster/device-id.js';
import type { GpuReservation } from './reservations.js';
import { exact } from '../hosts/control.js';

interface LocalOwner {
  reserveLocal(ids: readonly string[]): GpuReservation;
  releaseLocal(reservation: GpuReservation): void;
}
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u;

/** Retained parent only. A copied lease token cannot reach this channel from a renderer. */
export function localReservationServer(
  owner: () => Promise<LocalOwner>,
  send: (value: object) => void,
) {
  const held = new Map<string, GpuReservation>();
  return async (message: Record<string, unknown>): Promise<void> => {
    if (typeof message.id !== 'string' || !uuid.test(message.id)) throw Error('INVALID_CONTROL');
    const id = message.id;
    if (message.type === 'gpu-acquire') {
      exact(message, ['type', 'id', 'devices']);
      if (
        !Array.isArray(message.devices) ||
        !message.devices.length ||
        message.devices.length > 16 ||
        held.size
      )
        throw Error('INVALID_CONTROL');
      const devices = message.devices.map((value) => {
        if (typeof value !== 'string' || decodeClusterDevice(value).kind !== 'local')
          throw Error('INVALID_CONTROL');
        return value;
      });
      // Recheck after owner startup so concurrent requests cannot reserve twice.
      const service = await owner();
      if (held.size) throw Error('INVALID_CONTROL');
      try {
        held.set(id, service.reserveLocal(devices));
        send({ type: 'gpu-result', id, ok: true });
      } catch (error) {
        if (error instanceof Error && error.message === 'GPU_BUSY')
          send({ type: 'gpu-result', id, ok: false });
        else throw error;
      }
    } else {
      exact(message, ['type', 'id']);
      if (message.type !== 'gpu-release' || !held.has(id)) throw Error('INVALID_CONTROL');
      (await owner()).releaseLocal(held.get(id)!);
      held.delete(id);
      send({ type: 'gpu-result', id, ok: true });
    }
  };
}

/** Admission remains quarantined if its owner fails or a reply never arrives. */
export function localReservationClient(send: (value: object) => void) {
  const pending = new Map<string, { resolve(): void; reject(error: Error): void }>();
  let failed = false;
  const call = (id: string, message: object) => {
    if (failed || pending.size >= 2 || pending.has(id)) return Promise.reject(Error('NOT_READY'));
    const reply = new Promise<void>((resolve, reject) => pending.set(id, { resolve, reject }));
    try {
      send(message);
    } catch {
      pending.delete(id);
      throw Error('CORE_EXITED');
    }
    return peerDeadline(reply, 10000, 'GPU_RESERVATION_TIMEOUT').catch((error) => {
      if (!(error instanceof Error && error.message === 'GPU_BUSY')) failed = true;
      pending.delete(id);
      throw error;
    });
  };
  return {
    receive(message: Record<string, unknown>) {
      exact(message, ['type', 'id', 'ok']);
      if (
        message.type !== 'gpu-result' ||
        typeof message.id !== 'string' ||
        typeof message.ok !== 'boolean'
      )
        throw Error('INVALID_CONTROL');
      const entry = pending.get(message.id);
      if (!entry) throw Error('INVALID_CONTROL');
      pending.delete(message.id);
      if (message.ok) entry.resolve();
      else entry.reject(Error('GPU_BUSY'));
    },
    close() {
      failed = true;
      for (const entry of pending.values()) entry.reject(Error('CORE_EXITED'));
      pending.clear();
    },
    async reserve(devices: readonly string[]) {
      if (
        !devices.length ||
        devices.length > 16 ||
        devices.some((id) => decodeClusterDevice(id).kind !== 'local')
      )
        throw Error('INVALID_GPU_RESERVATION');
      const id = randomUUID();
      await call(id, { type: 'gpu-acquire', id, devices });
      let release: Promise<void> | undefined;
      return { release: () => (release ??= call(id, { type: 'gpu-release', id })) };
    },
  };
}
