import { hostname, networkInterfaces } from 'node:os';
import { open, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { ownershipBinding } from '../hosts/windows-ownership.js';
import { discoverResources } from '../hosts/resource-probe.js';
import { ReconnectBackoff } from './reconnect-backoff.js';
import { isTransientPeerFailure } from './deadline.js';
import { openWindowsPeerIdentity } from './windows-identity.js';
import type { WindowsPeerIdentity } from './windows-identity.js';
import { PeerNode } from './node.js';
import { decodePeerCommand, decodePeerReply, privatePeerHost } from './wire.js';
import type { PeerReply, PeerView } from './wire.js';
import type { PeerRequestView } from './wire.js';
import { decodePeerHardware } from './hardware.js';
import type { PeerHardware } from './hardware.js';
import { decodeClusterDevice } from '../cluster/device-id.js';
import type { Duplex } from 'node:stream';
import type { GpuReservation } from './reservations.js';
import type { PeerRpcBackend } from './rpc.js';
import type { PeerResources } from './resources.js';
import { PeerTrustStore } from './trust-store.js';
import { PeerTelemetryMonitor } from './telemetry-monitor.js';
import type { PeerOverlayTransport } from './overlay.js';

/** One utility-owned installation identity. No renderer filesystem/root input. */
export class PeerOwner {
  setOverlay(transport: PeerOverlayTransport): void {
    this.node.setOverlay(transport);
  }
  acceptOverlay(port: number, stream: Duplex): void {
    this.node.acceptOverlay(port, stream);
  }
  private operations: Promise<void> = Promise.resolve();
  private queued = 0;
  private closed = false;
  private readonly listeners = new Set<(reply: PeerReply) => void>();
  private readonly remote = new Map<string, PeerRequestView>();
  private readonly watches = new Map<string, Promise<void>>();
  private readonly retryWaiters = new Set<() => void>();
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private telemetryTimer: ReturnType<typeof setTimeout> | undefined;
  private telemetry = new Map<string, PeerTelemetryMonitor>();
  private constructor(
    private readonly node: PeerNode,
    private readonly identity: WindowsPeerIdentity,
    private readonly caller: string,
    private readonly addresses: readonly string[],
  ) {
    this.telemetryTimer = setTimeout(() => {
      void this.pollTelemetry();
    }, 0);
  }
  private async pollTelemetry(): Promise<void> {
    if (this.closed) return;
    const approved = this.node
      .snapshot()
      .outgoing.filter((peer) => peer.verified && this.remote.get(peer.id)?.phase === 'approved');
    const ids = new Set(approved.map((peer) => peer.id));
    for (const [id, monitor] of this.telemetry)
      if (!ids.has(id)) {
        monitor.close();
        this.telemetry.delete(id);
      }
    try {
      for (const peer of approved) {
        if (this.closed) break;
        let monitor = this.telemetry.get(peer.id);
        if (!monitor) {
          monitor = new PeerTelemetryMonitor({
            ping: (signal) => this.node.pingTelemetry(peer.id, signal),
            bandwidth: (signal) => this.node.measureTelemetry(peer.id, signal),
            totals: () => this.node.trafficTotals(peer.id),
            active: () => this.node.telemetryBusy(peer.id),
            changed: () => this.emit(),
            bandwidthCooldownMs: this.identity.fingerprint < peer.peerFingerprint ? 60000 : 75000,
          });
          this.telemetry.set(peer.id, monitor);
        }
        await monitor.tick();
      }
    } finally {
      if (!this.closed)
        this.telemetryTimer = setTimeout(() => {
          void this.pollTelemetry();
        }, 3000);
    }
  }
  /** Only the retained runtime parent can suspend diagnostics before native admission. */
  async setRuntimeBusy(busy: boolean): Promise<void> {
    this.node.setRuntimeBusy(busy);
    for (const monitor of this.telemetry.values()) monitor.setActive(busy);
    await this.node.notifyRuntimeActivity(busy);
  }
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
      const gpus = (resources.gpus ?? [])
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
      const store = new PeerTrustStore(directory, identity.fingerprint, undefined, native);
      const initial = await store.read();
      const node = new PeerNode(identity, hostname().slice(0, 80), gpus, backend, undefined, {
        initial,
        save: (records) => store.write(records),
      });
      const owner = new PeerOwner(node, identity, caller, addresses);
      owner.reconnect();
      return owner;
    } catch (error) {
      identity.close();
      throw error;
    }
  }
  private reconnect(): void {
    const retries = new ReconnectBackoff();
    const run = async () => {
      if (this.closed) return;
      const addresses = this.node.rememberedAddresses();
      retries.retain(addresses);
      for (const address of addresses) {
        if (this.closed) break;
        const peers = this.node.snapshot().outgoing;
        if (
          peers.some((p) => p.address === address && this.remote.get(p.id)?.phase === 'approved')
        ) {
          retries.reset(address);
          continue;
        }
        if (!retries.begin(address)) continue;
        try {
          await this.command(this.caller, { action: 'invite', address }, true);
        } catch {
          /* Bounded retry retains offline identity without granting access. */
        }
      }
      if (!this.closed)
        this.reconnectTimer = setTimeout(() => {
          void run();
        }, 5000);
    };
    this.reconnectTimer = setTimeout(() => {
      void run();
    }, 0);
  }
  subscribe(listener: (reply: PeerReply) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  async updateHardware(input: PeerHardware): Promise<void> {
    if (this.closed) return;
    await this.node.updateHardware(decodePeerHardware(input));
    this.emit();
  }
  private emit(): void {
    if (this.closed) return;
    const reply = decodePeerReply({ ok: true, view: this.cachedView() });
    for (const listener of this.listeners) listener(reply);
  }
  private watch(id: string): void {
    if (this.closed || this.watches.has(id) || this.node.isDisconnected(id)) return;
    const work = (async () => {
      let revision = -1;
      let basicReporter = false;
      let transportFailures = 0;
      while (!this.closed) {
        try {
          const current = this.node.snapshot().outgoing.find((peer) => peer.id === id);
          if (!current) return;
          const status = await this.node.status(id);
          if (status.phase !== 'approved' || !current.verified) {
            transportFailures = 0;
            const previous = this.remote.get(id);
            const view: PeerRequestView = {
              id: current.id,
              name: current.name,
              peerFingerprint: current.peerFingerprint,
              phase: status.phase,
              localVerified: current.verified,
              remoteVerified: false,
              gpus: [],
              address: current.address,
            };
            this.remote.set(id, view);
            if (!isDeepStrictEqual(previous, view)) this.emit();
            if (status.phase === 'declined') return;
            await this.retryDelay(250);
            continue;
          }
          let next: Awaited<ReturnType<PeerNode['watchInventory']>>;
          try {
            next = basicReporter
              ? await this.node.basicInventory(id)
              : await this.node.watchInventory(id, revision);
          } catch (error) {
            // An older authenticated reporter can reject this extension while remaining approved.
            if (
              basicReporter ||
              !(error instanceof Error) ||
              !['INVALID_PEER_MESSAGE', 'UNKNOWN_PEER_OPERATION'].includes(error.message)
            )
              throw error;
            next = await this.node.basicInventory(id);
            basicReporter = true;
          }
          if (this.closed || this.node.isDisconnected(id)) return;
          const peer = this.node.snapshot().outgoing.find((peer) => peer.id === id);
          if (!peer?.verified) return;
          const previous = this.remote.get(id);
          const view: PeerRequestView = {
            id: peer.id,
            name: peer.name,
            peerFingerprint: peer.peerFingerprint,
            phase: 'approved',
            localVerified: true,
            remoteVerified: true,
            gpus: next.gpus,
            address: next.address,
            ...(next.hardware ? { hardware: next.hardware } : {}),
          };
          this.remote.set(id, view);
          transportFailures = 0;
          if (revision !== next.revision || !isDeepStrictEqual(previous, view)) this.emit();
          revision = next.revision;
          if (basicReporter) await this.retryDelay(1500);
        } catch (error) {
          if (
            this.closed ||
            this.node.isDisconnected(id) ||
            (error instanceof Error && error.message === 'PEER_DISCONNECTED')
          )
            return;
          const peer = this.node.snapshot().outgoing.find((peer) => peer.id === id);
          if (!peer) return;
          const previous = this.remote.get(id);
          if (
            previous?.phase === 'approved' &&
            isTransientPeerFailure(error) &&
            ++transportFailures < 2
          ) {
            // Confirm with fresh authenticated status and inventory, never a stale replay.
            revision = -1;
            await this.retryDelay(250);
            continue;
          }
          this.remote.set(id, {
            id: peer.id,
            name: peer.name,
            peerFingerprint: peer.peerFingerprint,
            phase: 'disconnected',
            localVerified: peer.verified,
            remoteVerified: false,
            gpus: [],
            address: peer.address,
          });
          if (previous?.phase !== 'disconnected') this.emit();
          revision = -1;
          basicReporter = false;
          await this.retryDelay(3000);
        }
      }
    })();
    this.watches.set(id, work);
    void work.finally(() => this.watches.delete(id));
  }
  private retryDelay(milliseconds: number): Promise<void> {
    if (this.closed) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.retryWaiters.delete(done);
        resolve();
      };
      const timer = setTimeout(done, milliseconds);
      this.retryWaiters.add(done);
    });
  }
  command(caller: string, input: unknown, automatic = false): Promise<PeerReply> {
    const command = decodePeerCommand(input);
    if (this.closed || caller !== this.caller)
      return Promise.resolve({ ok: false, error: 'NOT_READY' });
    // Local inventory must remain readable while remote mutations wait for the network.
    if (command.action === 'read') {
      for (const peer of this.node.snapshot().outgoing) this.watch(peer.id);
      return Promise.resolve(decodePeerReply({ ok: true, view: this.cachedView() }));
    }
    if (this.queued >= 16) return Promise.resolve({ ok: false, error: 'NOT_READY' });
    ++this.queued;
    const operation = this.operations.then(async (): Promise<PeerReply> => {
      try {
        if (this.closed) return { ok: false, error: 'NOT_READY' };
        let alreadyConnected = false;
        switch (command.action) {
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
            // A queued background retry must not undo a later manual disconnect.
            if (
              automatic &&
              !this.node.rememberedAddresses().includes(new URL(command.address).hostname)
            )
              break;
            alreadyConnected =
              (
                await this.node.invite(
                  command.address,
                  command.expectedFingerprint,
                  automatic
                    ? []
                    : [...this.remote.values()]
                        .filter(
                          (peer) =>
                            peer.phase === 'approved' && peer.localVerified && peer.remoteVerified,
                        )
                        .map((peer) => peer.id),
                )
              ).alreadyConnected === true;
            break;
          case 'disconnect':
            try {
              await this.node.disconnect(command.id);
            } finally {
              this.remote.delete(command.id);
              this.telemetry.get(command.id)?.close();
              this.telemetry.delete(command.id);
              this.emit();
            }
            break;
          case 'approve':
            {
              const peer = this.node.snapshot().incoming.find((p) => p.id === command.id);
              if (!peer) throw Error('UNKNOWN_PEER_REQUEST');
              await this.node.approve(command.id, peer.peerFingerprint);
            }
            break;
          case 'verify-code':
            await this.node.verifyCode(command.id, command.code);
            break;
          case 'cancel':
            await this.node.cancel(command.id);
            break;
          case 'decline':
            await this.node.decline(command.id);
            await this.node.flushTrust();
            break;
        }
        const view = await this.view();
        this.emit();
        return decodePeerReply({
          ok: true,
          view,
          ...(alreadyConnected ? { notice: 'ALREADY_CONNECTED' } : {}),
        });
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
        if (this.node.isDisconnected(value.id))
          return {
            ...value,
            phase: 'disconnected' as const,
            localVerified: value.verified,
            remoteVerified: false,
            gpus: [],
          };
        const cached = this.remote.get(value.id);
        if (cached?.phase === 'approved') return cached;
        try {
          const status = await this.node.status(value.id);
          const approved = value.verified && status.phase === 'approved';
          const result = {
            ...value,
            phase: status.phase,
            localVerified: value.verified,
            remoteVerified: approved,
            gpus: approved ? await this.node.inventory(value.id) : [],
          };
          this.watch(value.id);
          return result;
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
    for (const peer of outgoing)
      if (peer.phase === 'approved' && peer.localVerified && peer.remoteVerified)
        this.remote.set(peer.id, peer);
    return this.cachedView(outgoing);
  }
  private cachedView(outgoing?: readonly PeerRequestView[]): PeerView {
    const snapshot = this.node.snapshot();
    const current =
      outgoing ??
      snapshot.outgoing.map(
        (peer) =>
          (!this.node.isDisconnected(peer.id) ? this.remote.get(peer.id) : undefined) ?? {
            id: peer.id,
            name: peer.name,
            peerFingerprint: peer.peerFingerprint,
            phase: this.node.isDisconnected(peer.id)
              ? ('disconnected' as const)
              : ('pending' as const),
            localVerified: peer.verified,
            remoteVerified: false,
            gpus: [],
          },
      );
    return {
      fingerprint: snapshot.fingerprint,
      name: snapshot.name,
      sharing: snapshot.sharing,
      addresses: this.addresses,
      gpus: snapshot.gpus,
      sharedGpuIds: snapshot.sharedGpuIds,
      incoming: snapshot.incoming.map((value) => ({ ...value, gpus: [] })),
      outgoing: current.map((value) => ({
        id: value.id,
        name: value.name,
        peerFingerprint: value.peerFingerprint,
        phase: value.phase,
        localVerified: value.localVerified,
        remoteVerified: value.remoteVerified,
        gpus: value.gpus,
        ...(value.hardware ? { hardware: value.hardware } : {}),
        ...(value.address ? { address: value.address } : {}),
        ...(value.phase === 'approved' && this.telemetry.has(value.id)
          ? { telemetry: this.telemetry.get(value.id)!.view() }
          : {}),
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
    if (!peers[0]!.gpus.some((gpu) => gpu.id.toLowerCase() === device.uuid.toLowerCase()))
      throw Error('GPU_NOT_SHARED');
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
    // Every stream targets its requested shared physical GPU, even when several
    // GPUs belong to this installation. Never fall back to another shared GPU.
    if (!inventory.some((gpu) => gpu.id.toLowerCase() === device.uuid.toLowerCase()))
      throw new Error('GPU_NOT_SHARED');
    return this.node.openRpc(peer.id, device.uuid);
  }
  async close(): Promise<void> {
    this.closed = true;
    clearTimeout(this.telemetryTimer);
    for (const monitor of this.telemetry.values()) monitor.close();
    this.telemetry.clear();
    clearTimeout(this.reconnectTimer);
    this.listeners.clear();
    for (const wake of this.retryWaiters) wake();
    try {
      await this.node.close();
      await Promise.all(this.watches.values());
      await this.operations;
      await this.node.flushTrust();
    } finally {
      this.identity.close();
    }
  }
}
