import { hostname, networkInterfaces } from 'node:os';
import { open, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ownershipBinding } from '../hosts/windows-ownership.js';
import { discoverResources } from '../hosts/resource-probe.js';
import { openWindowsPeerIdentity } from './windows-identity.js';
import type { WindowsPeerIdentity } from './windows-identity.js';
import { PeerNode } from './node.js';
import { decodePeerCommand, decodePeerReply, privatePeerHost } from './wire.js';
import type { PeerReply, PeerView } from './wire.js';
import { decodeClusterDevice } from '../cluster/device-id.js';
import type { Duplex } from 'node:stream';
import type { GpuReservation } from './reservations.js';
import type { PeerRpcBackend } from './rpc.js';
import type { PeerResources } from './resources.js';

/** One utility-owned installation identity. No renderer filesystem/root input. */
export class PeerOwner {
  private operations: Promise<void> = Promise.resolve();
  private queued = 0;
  private closed = false;
  private constructor(
    private readonly node: PeerNode,
    private readonly identity: WindowsPeerIdentity,
    private readonly caller: string,
    private readonly gpus: PeerView['gpus'],
    private readonly addresses: readonly string[],
  ) {}
  static async open(
    applicationData: string,
    caller: string,
    backend?: PeerRpcBackend,
  ): Promise<PeerOwner> {
    const native = ownershipBinding();
    const directory = path.join(applicationData, 'peers');
    native.privateDirectory(directory);
    const filename = path.join(directory, 'identity.dpapi');
    let saved: Buffer | undefined;
    try {
      const lock = native.sealFiles([filename]);
      try {
        const file = await open(filename, 'r');
        try {
          const stat = await file.stat();
          if (!stat.isFile() || stat.nlink !== 1 || stat.size < 32 || stat.size > 65536)
            throw new Error('PEER_IDENTITY_UNAVAILABLE');
          saved = await file.readFile();
        } finally {
          await file.close();
        }
      } finally {
        native.releaseFiles(lock);
      }
    } catch {
      // Distinguish a truly absent identity from corrupt/inaccessible protection.
      try {
        const file = await open(filename, 'r');
        await file.close();
        throw new Error('PEER_IDENTITY_UNAVAILABLE');
      } catch (error: unknown) {
        if (!error || typeof error !== 'object' || Reflect.get(error, 'code') !== 'ENOENT')
          throw error;
      }
    }
    const identity = await openWindowsPeerIdentity(saved);
    try {
      // First creation is exclusive: a racing process must never replace a
      // different installation key that won the initial creation.
      const temporary = saved ? path.join(directory, `identity-${randomUUID()}.tmp`) : filename;
      const file = await open(temporary, 'wx');
      try {
        await file.writeFile(identity.protectedIdentity);
        await file.sync();
      } finally {
        await file.close();
      }
      if (saved) {
        try {
          await rename(temporary, filename);
        } catch (error) {
          await unlink(temporary);
          throw error;
        }
      }
      const resources = await discoverResources();
      if (!resources.gpus) throw new Error('GPU_INVENTORY_UNAVAILABLE');
      const gpus = resources.gpus
        .filter((gpu) => gpu.total !== null)
        .map((gpu) => ({
          id: gpu.uuid,
          name: gpu.name ?? 'NVIDIA GPU',
          memoryBytes: gpu.total!,
        }));
      const addresses = [
        ...new Set(
          Object.values(networkInterfaces()).flatMap((list) =>
            (list ?? [])
              .filter(
                (value) =>
                  value.family === 'IPv4' && !value.internal && privatePeerHost(value.address),
              )
              .map((value) => value.address),
          ),
        ),
      ];
      const node = new PeerNode(identity, hostname().slice(0, 80), gpus, backend);
      return new PeerOwner(node, identity, caller, gpus, addresses);
    } catch (error) {
      identity.close();
      throw error;
    }
  }
  command(caller: string, input: unknown): Promise<PeerReply> {
    const command = decodePeerCommand(input);
    if (this.closed || caller !== this.caller || this.queued >= 16)
      return Promise.resolve({ ok: false, error: 'NOT_READY' });
    ++this.queued;
    const operation = this.operations.then(async (): Promise<PeerReply> => {
      try {
        if (this.closed) return { ok: false, error: 'NOT_READY' };
        switch (command.action) {
          case 'read':
            break;
          case 'share':
            if (!this.addresses.includes(command.address))
              throw new Error('INVALID_SHARING_ADDRESS');
            // Verify/install before advertising readiness; peer control requests
            // have a shorter deadline than first installation of the CUDA package.
            await this.node.localResources();
            await this.node.share(command.address, 49301, 49302, command.gpuIds);
            break;
          case 'stop-sharing':
            await this.node.stopSharing();
            break;
          case 'invite':
            await this.node.invite(command.address);
            break;
          case 'approve':
            await this.node.approve(command.id, command.fingerprint);
            break;
          case 'confirm':
            await this.node.confirm(command.id, command.fingerprint);
            break;
          case 'decline':
            this.node.decline(command.id);
            break;
        }
        return decodePeerReply({ ok: true, view: await this.view() });
      } catch (error: unknown) {
        const code =
          error instanceof Error && /^[A-Z_]{1,64}$/u.test(error.message)
            ? error.message
            : 'PEER_UNAVAILABLE';
        return { ok: false, error: code };
      }
    });
    this.operations = operation
      .then(
        () => undefined,
        () => undefined,
      )
      .finally(() => {
        --this.queued;
      });
    return operation;
  }
  private async view(): Promise<PeerView> {
    const snapshot = this.node.snapshot();
    const outgoing = await Promise.all(
      snapshot.outgoing.map(async (value) => {
        try {
          const status = await this.node.status(value.id);
          const approved = value.verified && status.phase === 'approved';
          return {
            ...value,
            phase: status.phase,
            localVerified: value.verified,
            remoteVerified: approved,
            gpus: approved ? await this.node.inventory(value.id) : [],
          };
        } catch {
          return {
            ...value,
            phase: 'disconnected' as const,
            localVerified: value.verified,
            remoteVerified: false,
            gpus: [],
          };
        }
      }),
    );
    return {
      fingerprint: snapshot.fingerprint,
      name: snapshot.name,
      sharing: snapshot.sharing,
      addresses: this.addresses,
      gpus: this.gpus,
      sharedGpuIds: snapshot.sharedGpuIds,
      incoming: snapshot.incoming.map((value) => ({ ...value, gpus: [] })),
      outgoing: outgoing.map((value) => ({
        id: value.id,
        name: value.name,
        peerFingerprint: value.peerFingerprint,
        phase: value.phase,
        localVerified: value.localVerified,
        remoteVerified: value.remoteVerified,
        gpus: value.gpus,
      })),
    };
  }
  /** Trusted runtime-owner capability, intentionally absent from PeerCommand. */
  reserveLocal(gpuIds: readonly string[]): GpuReservation {
    if (this.closed) throw new Error('NOT_READY');
    return this.node.reserveLocal(gpuIds);
  }
  releaseLocal(reservation: GpuReservation): void {
    this.node.releaseLocal(reservation);
  }
  async resources(deviceIdentity: string | null): Promise<PeerResources> {
    if (this.closed) throw Error('NOT_READY');
    if (deviceIdentity === null) return this.node.localResources();
    const device = decodeClusterDevice(deviceIdentity);
    if (device.kind !== 'peer') throw Error('INVALID_CLUSTER_DEVICE');
    // A revoked connection can retain its local pin after a fresh invitation.
    const peers = (await this.view()).outgoing.filter(
      (peer) =>
        peer.phase === 'approved' &&
        peer.localVerified &&
        peer.remoteVerified &&
        peer.peerFingerprint === device.peer,
    );
    if (peers.length !== 1) throw Error('PEER_NOT_APPROVED');
    const resources = await this.node.resources(peers[0]!.id);
    if (!resources.gpus.some((gpu) => gpu.uuid.toLowerCase() === device.uuid.toLowerCase()))
      throw Error('GPU_NOT_SHARED');
    return resources;
  }
  async openRpc(deviceIdentity: string): Promise<Duplex> {
    if (this.closed) throw new Error('NOT_READY');
    const device = decodeClusterDevice(deviceIdentity);
    if (device.kind !== 'peer') throw new Error('INVALID_CLUSTER_DEVICE');
    const peers = (await this.view()).outgoing.filter(
      (peer) =>
        peer.phase === 'approved' &&
        peer.localVerified &&
        peer.remoteVerified &&
        peer.peerFingerprint === device.peer,
    );
    if (peers.length !== 1) throw new Error('PEER_NOT_APPROVED');
    const peer = peers[0]!;
    const inventory = await this.node.inventory(peer.id);
    // First native worker supports one explicitly shared physical GPU. Never
    // silently choose another GPU or treat its ordinal as a local identity.
    if (inventory.length !== 1 || inventory[0]!.id.toLowerCase() !== device.uuid.toLowerCase())
      throw new Error('UNSUPPORTED_PEER_GPU');
    return this.node.openRpc(peer.id);
  }
  async close(): Promise<void> {
    this.closed = true;
    try {
      await this.node.close();
      await this.operations;
    } finally {
      this.identity.close();
    }
  }
}
