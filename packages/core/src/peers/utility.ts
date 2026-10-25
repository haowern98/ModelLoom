import { PeerOwner } from './owner.js';
import { decodePeerCommand } from './wire.js';
import type { PeerReply } from './wire.js';
import { decodeObject, exact } from '../hosts/control.js';
import { peerDeadline, PEER_CLEANUP_MS } from './deadline.js';
import { rpcIpcStream } from './ipc-rpc.js';
import type { Duplex } from 'node:stream';
import { decodeClusterDevice } from '../cluster/device-id.js';
import { localReservationServer } from './local-reservation-channel.js';
import type { GpuReservation } from './reservations.js';
import { decodePeerRuntimeBootstrap, developmentPeerBackend } from './development-runtime.js';
import type { PeerRuntimeBootstrap } from './development-runtime.js';
import { servePeerResources } from './resource-channel.js';
import type { PeerResources } from './resources.js';
import { decodePeerHardware } from './hardware.js';
import type { PeerHardware } from './hardware.js';
import { decodePeerReply } from './wire.js';
import { overlayChannel } from './overlay-channel.js';
import type { PeerOverlayTransport } from './overlay.js';

export interface PeerUtilityChannel {
  send(text: string): void;
  receive(handler: (message: unknown) => void): void;
  exit(code: number): void;
}
interface Service {
  setOverlay?(transport: PeerOverlayTransport): void;
  acceptOverlay?(port: number, stream: Duplex): void;
  setRuntimeBusy?(busy: boolean): void | Promise<void>;
  updateHardware?(hardware: PeerHardware): Promise<void>;
  subscribe?(listener: (reply: PeerReply) => void): () => void;
  command(caller: string, input: unknown): Promise<PeerReply>;
  close(): Promise<void>;
  openRpc?(device: string): Promise<Duplex>;
  reserveLocal?(devices: readonly string[]): GpuReservation;
  releaseLocal?(reservation: GpuReservation): void;
  resources?(device: string | null): Promise<PeerResources>;
}

/** Installation-lifetime peer core. Only its retained parent can admit the fixed
 * profile root. Model selection, renderer messages and peers cannot supply it. */
export function runPeerUtility(
  channel: PeerUtilityChannel,
  open: (root: string, caller: string, runtime?: PeerRuntimeBootstrap) => Promise<Service> = (
    root,
    caller,
    runtime,
  ) => PeerOwner.open(root, caller, runtime ? developmentPeerBackend(runtime) : undefined),
): void {
  let preparation: Promise<Service> | undefined;
  let unsubscribe: (() => void) | undefined;
  let caller = '',
    sequence = 0,
    closed = false;
  const streams = new Map<string, ReturnType<typeof rpcIpcStream>>();
  const settled = new Set<string>();
  const send = (value: object) => {
    const text = JSON.stringify(value);
    if (Buffer.byteLength(text) > 131072) throw new Error('INVALID_CONTROL');
    channel.send(text);
  };
  const reservations = localReservationServer(async () => {
    if (!preparation || closed) throw new Error('NOT_READY');
    const owner = await preparation;
    if (closed || !owner.reserveLocal || !owner.releaseLocal) throw new Error('NOT_READY');
    return {
      reserveLocal: owner.reserveLocal.bind(owner),
      releaseLocal: owner.releaseLocal.bind(owner),
      ...(owner.setRuntimeBusy ? { setRuntimeBusy: owner.setRuntimeBusy.bind(owner) } : {}),
    };
  }, send);
  const overlay = overlayChannel(send);
  overlay.incoming((port, stream) => {
    if (!preparation || closed) {
      stream.destroy();
      return;
    }
    void preparation
      .then((owner) => {
        if (closed || stream.destroyed || !owner.acceptOverlay) {
          stream.destroy();
          return;
        }
        owner.acceptOverlay(port, stream);
      })
      .catch(() => stream.destroy());
  });
  async function close(code: number) {
    if (closed) return;
    closed = true;
    overlay.close();
    unsubscribe?.();
    for (const pipe of streams.values()) pipe.stream.destroy();
    streams.clear();
    try {
      if (preparation)
        await peerDeadline(
          preparation.then((owner) => owner.close()),
          PEER_CLEANUP_MS,
          'PEER_CLEANUP_FAILED',
        );
      send({ type: 'closed' });
      channel.exit(code);
    } catch {
      channel.exit(1);
    }
  }
  channel.receive((input) => {
    try {
      if (typeof input !== 'string' || Buffer.byteLength(input) > 262144 || closed)
        throw new Error('INVALID_CONTROL');
      const message = decodeObject(input);
      // Only the bounded route snapshot may exceed ordinary control-frame size.
      if (message.type !== 'overlay-routes' && Buffer.byteLength(input) > 16384)
        throw Error('INVALID_CONTROL');
      if (typeof message.type === 'string' && message.type.startsWith('overlay-')) {
        if (!preparation) throw Error('INVALID_CONTROL');
        overlay.receive(message);
        return;
      }
      if (message.type === 'hardware-update') {
        exact(message, ['type', 'hardware']);
        if (!preparation) throw Error('INVALID_CONTROL');
        const hardware = decodePeerHardware(message.hardware);
        void preparation
          .then((owner) => {
            if (closed || !owner.updateHardware) throw Error('NOT_READY');
            return owner.updateHardware(hardware);
          })
          .catch(() => close(1));
        return;
      }
      if (message.type === 'resource-read') {
        if (!preparation) throw new Error('INVALID_CONTROL');
        void servePeerResources(
          message,
          async (device) => {
            const owner = await preparation!;
            if (closed || !owner.resources) throw Error('NOT_READY');
            return owner.resources(device);
          },
          (value) => {
            if (!closed) send(value);
          },
        ).catch(() => close(1));
        return;
      }
      if (
        message.type === 'gpu-acquire' ||
        message.type === 'gpu-release' ||
        message.type === 'runtime-activity'
      ) {
        if (!preparation) throw new Error('INVALID_CONTROL');
        void reservations(message).catch(() => close(1));
        return;
      }
      if (typeof message.type === 'string' && message.type.startsWith('rpc-')) {
        if (!preparation) throw new Error('INVALID_CONTROL');
        if (message.type === 'rpc-open') {
          exact(message, ['type', 'id', 'device']);
          if (
            typeof message.id !== 'string' ||
            streams.has(message.id) ||
            streams.size >= 4 ||
            typeof message.device !== 'string'
          )
            throw new Error('INVALID_CONTROL');
          const id = message.id,
            device = message.device;
          if (decodeClusterDevice(device).kind !== 'peer')
            throw new Error('INVALID_CLUSTER_DEVICE');
          const pipe = rpcIpcStream(id, send);
          streams.set(id, pipe);
          pipe.stream.once('close', () => {
            streams.delete(id);
            settled.add(id);
            if (settled.size > 16) settled.delete(settled.values().next().value!);
          });
          void preparation
            .then(async (owner) => {
              if (closed || pipe.stream.destroyed || !owner.openRpc) throw new Error('NOT_READY');
              const remote = await owner.openRpc(device);
              if (closed || pipe.stream.destroyed) {
                remote.destroy();
                return;
              }
              pipe.stream.once('close', () => remote.destroy());
              remote.once('error', () => pipe.stream.destroy());
              remote.once('close', () => pipe.stream.destroy());
              send({ type: 'rpc-ready', id });
              remote.pipe(pipe.stream);
              pipe.stream.pipe(remote);
            })
            .catch(() => {
              if (!closed) send({ type: 'rpc-error', id });
              pipe.stream.destroy();
            });
        } else {
          if (typeof message.id !== 'string') throw new Error('INVALID_CONTROL');
          const pipe = streams.get(message.id);
          if (pipe) pipe.receive(message);
          else if (message.type !== 'rpc-close' && !settled.has(message.id))
            throw new Error('INVALID_CONTROL');
        }
        return;
      }
      if (message.type === 'admit') {
        exact(message, [
          'type',
          'applicationData',
          'caller',
          ...(Object.hasOwn(message, 'runtime') ? ['runtime'] : []),
        ]);
        if (
          preparation ||
          typeof message.applicationData !== 'string' ||
          message.applicationData.length > 1024 ||
          typeof message.caller !== 'string' ||
          !/^[a-zA-Z0-9_-]{1,128}$/u.test(message.caller)
        )
          throw new Error('INVALID_CONTROL');
        caller = message.caller;
        preparation = Object.hasOwn(message, 'runtime')
          ? open(message.applicationData, caller, decodePeerRuntimeBootstrap(message.runtime))
          : open(message.applicationData, caller);
        void preparation.then(
          (owner) => {
            if (!closed) {
              owner.setOverlay?.(overlay.transport);
              unsubscribe = owner.subscribe?.((reply) => {
                if (!closed) send({ type: 'peer-changed', reply: decodePeerReply(reply) });
              });
              send({ type: 'ready' });
            }
          },
          () => close(1),
        );
      } else if (message.type === 'quit') {
        exact(message, ['type']);
        void close(0);
      } else {
        exact(message, ['type', 'id', 'caller', 'command']);
        if (
          message.type !== 'command' ||
          !preparation ||
          message.caller !== caller ||
          !Number.isSafeInteger(message.id) ||
          (message.id as number) <= sequence
        )
          throw new Error('INVALID_CONTROL');
        sequence = message.id as number;
        const command = decodePeerCommand(message.command),
          id = sequence;
        void preparation
          .then((owner): PeerReply | Promise<PeerReply> =>
            closed ? { ok: false, error: 'NOT_READY' } : owner.command(caller, command),
          )
          .then(
            (reply) => {
              if (!closed) send({ type: 'reply', id, reply });
            },
            () => close(1),
          );
      }
    } catch {
      void close(1);
    }
  });
  send({ type: 'booted' });
}
