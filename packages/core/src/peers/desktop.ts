import { fileURLToPath } from 'node:url';
import { ownershipBinding, confirmExit } from '../hosts/windows-ownership.js';
import type { UtilityFork } from '../hosts/desktop.js';
import { decodeObject, exact } from '../hosts/control.js';
import { decodePeerCommand, decodePeerReply } from './wire.js';
import type { PeerReply } from './wire.js';
import { peerDeadline, RPC_OPEN_MS, SHARING_APPROVAL_MS, PEER_CLEANUP_MS } from './deadline.js';
import { rpcIpcStream } from './ipc-rpc.js';
import { randomUUID } from 'node:crypto';
import type { Duplex } from 'node:stream';
import { decodeClusterDevice } from '../cluster/device-id.js';
import { localReservationClient } from './local-reservation-channel.js';
import type { PeerRuntimeBootstrap } from './development-runtime.js';
import { peerResourceClient } from './resource-channel.js';
import type { PeerResources } from './resources.js';

export interface DesktopPeerHost {
  command(caller: string, input: unknown): Promise<PeerReply>;
  close(): Promise<void>;
  openRpc(device: string): Promise<Duplex>;
  reserveLocal(devices: readonly string[]): Promise<{ release(): Promise<void> }>;
  resources(device: string | null): Promise<PeerResources>;
}
/** Dedicated peer owner survives replacing a model's history/runtime core. Main
 * retains process containment, while protected identity and TLS stay in core. */
export async function createDesktopPeerHost(
  fork: UtilityFork,
  applicationData: string,
  caller: string,
  runtime?: PeerRuntimeBootstrap,
): Promise<DesktopPeerHost> {
  const native = ownershipBinding(),
    root = native.createDeployment(),
    began = Date.now();
  let child: ReturnType<UtilityFork>;
  try {
    child = fork(fileURLToPath(new URL('../../scripts/peer-entry.cjs', import.meta.url)));
  } catch (error) {
    native.closeDeployment(root);
    throw error;
  }
  let spawned = false,
    booted = false,
    admitted = false,
    alive = true,
    closing: Promise<void> | undefined,
    sequence = 0;
  let cleanupConfirmed = false;
  let exitCode: number | undefined;
  let ready!: () => void, failed!: (error: Error) => void, exited!: () => void;
  const preparation = new Promise<void>((resolve, reject) => {
    ready = resolve;
    failed = reject;
  });
  const exit = new Promise<void>((resolve) => {
    exited = resolve;
  });
  const pending = new Map<
    number,
    {
      resolve(reply: PeerReply): void;
      reject(error: Error): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  const streams = new Map<
    string,
    { pipe: ReturnType<typeof rpcIpcStream>; ready(): void; reject(error: Error): void }
  >();
  const settled = new Set<string>();
  const remember = (id: string) => {
    settled.add(id);
    if (settled.size > 16) settled.delete(settled.values().next().value!);
  };
  const send = (value: object) => {
    if (!alive) throw new Error('CORE_EXITED');
    child.postMessage(JSON.stringify(value));
  };
  const reservations = localReservationClient(send);
  const resources = peerResourceClient(send);
  const admit = () => {
    if (!spawned || !booted || admitted) return;
    admitted = true;
    send({ type: 'admit', applicationData, caller, ...(runtime ? { runtime } : {}) });
  };
  child.on('spawn', () => {
    try {
      if (!child.pid) throw new Error('CORE_EXITED');
      native.admitCore(root, child.pid, process.execPath, began);
      spawned = true;
      admit();
    } catch {
      failed(new Error('OWNERSHIP_FAILED'));
      child.kill();
      native.closeDeployment(root);
    }
  });
  child.on('exit', (code: unknown) => {
    exitCode = typeof code === 'number' ? code : undefined;
    reservations.close();
    resources.close();
    alive = false;
    failed(new Error('CORE_EXITED'));
    exited();
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error('CORE_EXITED'));
    }
    pending.clear();
    for (const entry of streams.values()) {
      entry.reject(new Error('CORE_EXITED'));
      entry.pipe.stream.destroy();
    }
    streams.clear();
    native.closeDeployment(root);
  });
  child.on('message', (input) => {
    try {
      if (typeof input !== 'string' || Buffer.byteLength(input) > 131072)
        throw new Error('INVALID_CONTROL');
      const message = decodeObject(input);
      if (message.type === 'resource-result') {
        resources.receive(message);
        return;
      }
      if (message.type === 'gpu-result') {
        reservations.receive(message);
        return;
      }
      if (typeof message.type === 'string' && message.type.startsWith('rpc-')) {
        if (typeof message.id !== 'string') throw new Error('INVALID_CONTROL');
        const entry = streams.get(message.id);
        if (!entry) {
          if (message.type === 'rpc-close' || settled.has(message.id)) return;
          throw new Error('INVALID_CONTROL');
        }
        if (message.type === 'rpc-ready' || message.type === 'rpc-error') {
          exact(message, ['type', 'id']);
          if (message.type === 'rpc-ready') entry.ready();
          else {
            entry.reject(new Error('RPC_UNAVAILABLE'));
            entry.pipe.stream.destroy();
          }
        } else entry.pipe.receive(message);
        return;
      }
      if (message.type === 'booted') {
        exact(message, ['type']);
        if (booted) throw new Error('INVALID_CONTROL');
        booted = true;
        admit();
      } else if (message.type === 'ready') {
        exact(message, ['type']);
        if (!admitted) throw new Error('INVALID_CONTROL');
        ready();
      } else if (message.type === 'closed') {
        exact(message, ['type']);
        cleanupConfirmed = true;
      } else {
        exact(message, ['type', 'id', 'reply']);
        if (message.type !== 'reply' || !Number.isSafeInteger(message.id))
          throw new Error('INVALID_CONTROL');
        const entry = pending.get(message.id as number);
        if (!entry) return;
        const reply = decodePeerReply(message.reply);
        pending.delete(message.id as number);
        clearTimeout(entry.timer);
        entry.resolve(reply);
      }
    } catch {
      failed(new Error('INVALID_CONTROL'));
      native.closeDeployment(root);
    }
  });
  async function close(): Promise<void> {
    if (closing) return closing;
    closing = (async () => {
      for (const entry of streams.values()) {
        entry.reject(new Error('CORE_EXITED'));
        entry.pipe.stream.destroy();
      }
      streams.clear();
      try {
        if (alive) {
          send({ type: 'quit' });
          await peerDeadline(exit, PEER_CLEANUP_MS + 2000, 'PEER_STOP_TIMEOUT');
        }
      } finally {
        native.closeDeployment(root);
        await confirmExit(() => native.coresExited(root), 3000);
      }
      if (!cleanupConfirmed || exitCode !== 0) throw Error('PEER_CLEANUP_FAILED');
    })();
    return closing;
  }
  try {
    await peerDeadline(preparation, 20000, 'PEER_START_TIMEOUT');
  } catch (error) {
    await close().catch(() => undefined);
    throw error;
  }
  return {
    reserveLocal: (devices) => reservations.reserve(devices),
    resources: (device) => resources.read(device),
    async openRpc(device) {
      if (closing || !alive || streams.size >= 4) throw new Error('NOT_READY');
      if (decodeClusterDevice(device).kind !== 'peer') throw new Error('INVALID_CLUSTER_DEVICE');
      const id = randomUUID(),
        pipe = rpcIpcStream(id, send);
      const ready = new Promise<void>((resolve, reject) =>
        streams.set(id, { pipe, ready: resolve, reject }),
      );
      pipe.stream.once('close', () => {
        streams.get(id)?.reject(new Error('RPC_DISCONNECTED'));
        streams.delete(id);
        remember(id);
      });
      try {
        send({ type: 'rpc-open', id, device });
        await peerDeadline(ready, RPC_OPEN_MS, 'RPC_START_TIMEOUT');
        return pipe.stream;
      } catch (error) {
        pipe.stream.destroy();
        throw error;
      }
    },
    command(sender, input) {
      if (sender !== caller || closing || !alive || pending.size >= 16)
        return Promise.resolve({ ok: false, error: 'NOT_READY' });
      const command = decodePeerCommand(input),
        id = ++sequence;
      return new Promise<PeerReply>((resolve, reject) => {
        const timer = setTimeout(
          () => {
            pending.delete(id);
            reject(new Error('PEER_TIMEOUT'));
          },
          command.action === 'share'
            ? SHARING_APPROVAL_MS + 15000
            : command.action === 'stop-sharing'
              ? PEER_CLEANUP_MS + 1000
              : 20000,
        );
        pending.set(id, { resolve, reject, timer });
        try {
          send({ type: 'command', id, caller, command });
        } catch {
          pending.delete(id);
          clearTimeout(timer);
          reject(new Error('CORE_EXITED'));
        }
      });
    },
    close,
  };
}
