import { createServer, request as httpRequest } from 'node:http';
import type { IncomingMessage, ServerResponse, Server } from 'node:http';
import { createServer as createSecureServer, request as secureRequest } from 'node:https';
import type { Server as SecureServer } from 'node:https';
import { constants, randomUUID, X509Certificate } from 'node:crypto';
import type { Socket } from 'node:net';
import type { TLSSocket } from 'node:tls';
import { connect as tlsConnect } from 'node:tls';
import type { PeerOverlayTransport } from './overlay.js';
import { overlaySocket, isOverlaySocket } from './overlay-socket.js';
import { peerFingerprint, validatePeerCertificate } from './windows-identity.js';
import type { WindowsPeerIdentity } from './windows-identity.js';
import { connectPeerRpc } from './rpc.js';
import { rpcDiagnostics } from './rpc-diagnostics.js';
import type { RpcDiagnostic } from './rpc-diagnostics.js';
import {
  rpcResidencyStream,
  RPC_RESIDENCY_HEADER,
  RPC_RESIDENCY_VERSION,
} from './rpc-residency.js';
import type { OwnedPeerRpc, PeerRpcBackend } from './rpc.js';
import type { Duplex } from 'node:stream';
import { GpuReservations } from './reservations.js';
import type { GpuReservation } from './reservations.js';
import { decodePeerAddress, privatePeerHost as privateAddress } from './wire.js';
import { isTransientPeerFailure, peerDeadline } from './deadline.js';
import type { PeerFailure } from './failure-journal.js';
import { decodePeerResources } from './resources.js';
import type { PeerResources } from './resources.js';
import { decodePeerHardware } from './hardware.js';
import type { PeerHardware } from './hardware.js';
import { CodePairing, verifyPairingCode } from './pairing-code.js';
import type { PeerTrust } from './trust-store.js';
import { DiagnosticAdmission, serveDiagnostic, measureDiagnostic } from './diagnostics.js';
import { readPeerBody as body } from './peer-body.js';

export interface PeerGpu {
  readonly id: string;
  readonly name: string;
  readonly memoryBytes: number;
}
type Phase = 'pending' | 'approved' | 'declined';
interface Incoming {
  pairing?: CodePairing;
  allowedGpuIds?: readonly string[];
  id: string;
  name: string;
  peerFingerprint: string;
  certificate: Buffer;
  authority: Buffer;
  localVerified: boolean;
  remoteVerified: boolean;
  phase: Phase;
  expires: number;
}
interface Outgoing {
  id: string;
  name: string;
  peerFingerprint: string;
  certificate: Buffer;
  authority: Buffer;
  address: string;
  securePort: number;
  verified: boolean;
  expires?: number;
}
interface ActiveRpc {
  trace: RpcDiagnostic;
  id: string;
  socket: Duplex;
  owned: OwnedPeerRpc;
  reservation: GpuReservation;
  closing?: Promise<void>;
}
const invalid = (code = 'INVALID_PEER_MESSAGE'): never => {
  throw new Error(code);
};
const object = (value: unknown, keys: string[]): Record<string, unknown> => {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    return invalid();
  return value as Record<string, unknown>;
};
const text = (value: unknown, max = 80): string => {
  if (
    typeof value !== 'string' ||
    !value.length ||
    value.length > max ||
    [...value].some((item) => item.charCodeAt(0) < 32 || item.charCodeAt(0) === 127)
  )
    return invalid();
  return value;
};
export function peerAddress(input: string): URL {
  try {
    return decodePeerAddress(input);
  } catch {
    return invalid('INVALID_PEER_ADDRESS');
  }
}
function certificate(value: unknown): Buffer {
  const encoded = text(value, 12000);
  const result = Buffer.from(encoded, 'base64');
  if (result.length > 8192 || result.toString('base64') !== encoded) return invalid();
  return result;
}
function reply(response: ServerResponse, value: unknown, status = 200): void {
  const payload = JSON.stringify(value);
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    Connection: 'close',
  });
  response.end(payload);
}
function listen(server: Server | SecureServer, host: string, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const failed = (error: Error) => reject(error);
    server.once('error', failed);
    server.listen(port, host, () => {
      server.off('error', failed);
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('PEER_UNAVAILABLE'));
        return;
      }
      resolve(address.port);
    });
  });
}
async function exchange(
  url: URL,
  data: unknown,
  identity?: WindowsPeerIdentity,
  remote?: Buffer,
  signal?: AbortSignal,
  authority?: Buffer,
  overlay?: PeerOverlayTransport,
  deadlineMs = 5000,
  method: 'GET' | 'POST' = 'POST',
): Promise<unknown> {
  // Connection setup must share the request budget so heartbeat retries precede lease expiry.
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), deadlineMs);
  const requestSignal = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal;
  try {
    const raw = overlay?.has(url.hostname)
      ? overlaySocket(
          await overlay
            .dial(url.hostname, Number(url.port), requestSignal)
            .catch((error: unknown) => {
              if (timeout.signal.aborted && !signal?.aborted)
                throw new Error('PEER_UNAVAILABLE', {
                  cause: Object.assign(new Error('Peer request deadline exceeded'), {
                    code: 'ETIMEDOUT',
                  }),
                });
              // Normalize only local overlay transport errors, never an authenticated peer response.
              if (
                !signal?.aborted &&
                error instanceof Error &&
                ['OVERLAY_DISCONNECTED', 'OVERLAY_UNAVAILABLE', 'NETWORK_TIMEOUT'].includes(
                  error.message,
                )
              )
                throw new Error('PEER_UNAVAILABLE', {
                  cause: Object.assign(error, {
                    code: error.message === 'NETWORK_TIMEOUT' ? 'ETIMEDOUT' : 'ECONNRESET',
                  }),
                });
              throw error;
            }),
        )
      : undefined;
    if (requestSignal.aborted) {
      raw?.destroy();
      requestSignal.throwIfAborted();
    }
    if (Boolean(identity) !== Boolean(remote) || Boolean(identity) !== Boolean(authority))
      return Promise.reject(new Error('INVALID_PEER_CERTIFICATE'));
    return await new Promise((resolve, reject) => {
      const payload = method === 'GET' ? Buffer.alloc(0) : Buffer.from(JSON.stringify(data));
      let received: IncomingMessage | undefined;
      const finish = (error: Error | null, value?: unknown) => {
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(value);
      };
      const options = {
        method,
        agent: false as const,
        timeout: deadlineMs,
        signal: requestSignal,
        headers: { 'Content-Type': 'application/json', 'Content-Length': payload.length },
        ...(identity && remote && authority
          ? {
              pfx: identity.pfx,
              ca: new X509Certificate(authority).toString(),
              minVersion: 'TLSv1.3' as const,
              maxVersion: 'TLSv1.3' as const,
              rejectUnauthorized: true,
              checkServerIdentity: (_host: string, cert: { raw: Buffer }) =>
                peerFingerprint(cert.raw) === peerFingerprint(remote)
                  ? undefined
                  : new Error('FINGERPRINT_MISMATCH'),
            }
          : {}),
      };
      const connection = raw
        ? {
            agent: undefined,
            createConnection: () => (identity ? tlsConnect({ ...options, socket: raw }) : raw),
          }
        : {};
      const request = (identity ? secureRequest : httpRequest)(
        url,
        { ...options, ...connection },
        (response) => {
          received = response;
          void body(response).then(
            (value) => {
              if (response.statusCode !== 200) {
                const error: unknown =
                  value && typeof value === 'object' ? Reflect.get(value, 'error') : null;
                finish(
                  new Error(
                    typeof error === 'string' && /^[A-Z_]{1,64}$/u.test(error)
                      ? error
                      : 'PEER_UNAVAILABLE',
                  ),
                );
              } else finish(null, value);
            },
            () => finish(new Error('INVALID_PEER_MESSAGE')),
          );
        },
      );
      request.on('timeout', () =>
        request.destroy(Object.assign(new Error('PEER_TIMEOUT'), { code: 'ETIMEDOUT' })),
      );
      request.on('error', (error: Error & { code?: string }) => {
        // Owned duplex teardown can follow a complete HTTP reply before the
        // asynchronous body parser settles. That parser must still validate the
        // status, JSON and size; a truncated reply or any other error still fails.
        if (error.code === 'ERR_STREAM_PREMATURE_CLOSE' && received?.complete) return;
        const cause =
          timeout.signal.aborted && !signal?.aborted
            ? Object.assign(new Error('Peer request deadline exceeded'), { code: 'ETIMEDOUT' })
            : error;
        finish(new Error('PEER_UNAVAILABLE', { cause }));
      });
      request.end(payload);
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Core-owned pairing control. Bootstrap exchanges public certificates only;
 * TLS verifies their chains before either side can confirm the displayed pin.
 * Native RPC is deliberately not exposed by this control listener. */
export class PeerNode {
  private overlay: PeerOverlayTransport | undefined;
  setOverlay(overlay: PeerOverlayTransport): void {
    this.overlay = overlay;
  }
  acceptOverlay(port: number, stream: Duplex): void {
    const server = port === 49301 ? this.bootstrap : port === 49302 ? this.secure : undefined;
    if (!this.active || !server || this.sockets.size >= 32) {
      stream.destroy();
      return;
    }
    server.emit('connection', overlaySocket(stream));
  }
  private bootstrap: Server | undefined;
  private secure: SecureServer | undefined;
  private sockets = new Set<Socket>();
  private incoming = new Map<string, Incoming>();
  private introductions = new Map<string, Promise<void>>();
  private outgoing = new Map<string, Outgoing>();
  private shared = new Set<string>();
  private active = false;
  private starting = false;
  private securePort = 0;
  private rate: number[] = [];
  private codeRate: number[] = [];
  private revision = 0;
  private reservations: GpuReservations | undefined;
  private readonly activeRpc = new Map<GpuReservation, ActiveRpc>();
  private rpcFailed = false;
  private rpcTimer: ReturnType<typeof setInterval> | undefined;
  private rpcPreparations = new Set<Promise<void>>();
  private readonly lifetime = new AbortController();
  private invitations = 0;
  private trusted = new Map<string, PeerTrust>();
  private trustReady = new Set<string>();
  private trustSaving: Promise<void> = Promise.resolve();
  private trustPending = new Map<string, Promise<void>>();
  private outgoingRpc = new Map<Duplex, string>();
  private outgoingRequests = new WeakMap<Outgoing, AbortController>();
  private hardware: PeerHardware | undefined;
  private inventoryRevision = 0;
  private inventoryWaiters = new Set<() => void>();
  private pendingWatches = new Set<string>();
  private readonly diagnostics = new DiagnosticAdmission();
  private runtimeBusy = false;
  private remoteRuntimeBusy = new Map<string, boolean>();
  private rpcLoading = new Set<GpuReservation>();
  private openingRpc = 0;
  private remoteIdle = new Map<string, boolean>();
  private diagnosticsUnsupported = new Set<string>();
  private rpcTraffic = new Map<
    string,
    { sent: number; received: number; streams: Map<Duplex, { read: number; written: number }> }
  >();

  /** Retained runtime parent only, never a renderer-supplied activity claim. */
  setRuntimeBusy(busy: boolean): void {
    this.runtimeBusy = busy;
    if (busy) this.diagnostics.cancel();
  }
  telemetryBusy(id?: string): boolean {
    return (
      this.runtimeBusy ||
      this.openingRpc > 0 ||
      this.rpcPreparations.size > 0 ||
      this.rpcLoading.size > 0 ||
      [...this.remoteRuntimeBusy.values()].some(Boolean) ||
      (id !== undefined && this.remoteIdle.get(id) === false)
    );
  }
  /** Existing streams have their own authenticated heartbeat and worker-side lease. */
  hasActiveRpc(id: string): boolean {
    return [...this.outgoingRpc].some(([stream, peer]) => peer === id && !stream.destroyed);
  }
  /** Notify only the workers whose streams belong to this loaded runtime. */
  async notifyRuntimeActivity(busy: boolean): Promise<void> {
    await Promise.all(
      [...this.outgoing.values()]
        .filter(
          (peer) =>
            peer.verified &&
            this.rpcTraffic.get(peer.id)?.streams.size &&
            !this.diagnosticsUnsupported.has(peer.id),
        )
        .map(async (peer) => {
          try {
            const response = object(await this.call(peer.id, 'diagnostics-activity', { busy }), [
              'phase',
            ]);
            if (response.phase !== 'approved') throw Error('PEER_NOT_APPROVED');
          } catch (error) {
            // Older workers cannot run diagnostics, so they need no probe cancellation.
            if (
              !(error instanceof Error) ||
              !['UNKNOWN_PEER_OPERATION', 'INVALID_PEER_MESSAGE'].includes(error.message)
            )
              throw error;
            this.diagnosticsUnsupported.add(peer.id);
          }
        }),
    );
  }
  trafficTotals(id: string): { sent: number; received: number } {
    const traffic = this.rpcTraffic.get(id);
    let sent = traffic?.sent ?? 0,
      received = traffic?.received ?? 0;
    for (const [stream, base] of traffic?.streams ?? []) {
      sent += Math.max(0, (stream as Socket).bytesWritten - base.written);
      received += Math.max(0, (stream as Socket).bytesRead - base.read);
    }
    return { sent, received };
  }
  async pingTelemetry(id: string, signal: AbortSignal): Promise<number> {
    const start = performance.now();
    let response: unknown;
    try {
      response = this.diagnosticsUnsupported.has(id)
        ? await this.call(id, 'status', {}, signal)
        : await this.call(id, 'diagnostics-ping', {}, signal);
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !['UNKNOWN_PEER_OPERATION', 'INVALID_PEER_MESSAGE'].includes(error.message)
      )
        throw error;
      this.diagnosticsUnsupported.add(id);
      response = await this.call(id, 'status', {}, signal);
    }
    if (this.diagnosticsUnsupported.has(id)) {
      const status = object(response, ['phase']);
      if (status.phase !== 'approved') throw Error('PEER_NOT_APPROVED');
      return performance.now() - start;
    }
    const result = object(response, ['idle']);
    if (typeof result.idle !== 'boolean') return invalid();
    this.remoteIdle.set(id, result.idle);
    return performance.now() - start;
  }
  async measureTelemetry(
    id: string,
    signal: AbortSignal,
  ): Promise<{ uploadMbps: number | null; downloadMbps: number | null }> {
    const peer = this.outgoing.get(id);
    if (this.diagnosticsUnsupported.has(id)) throw Error('DIAGNOSTICS_UNSUPPORTED');
    if (!peer?.verified || !this.remoteIdle.get(id)) throw Error('DIAGNOSTICS_BUSY');
    if (this.telemetryBusy()) throw Error('DIAGNOSTICS_BUSY');
    const probe = this.diagnostics.acquire(`out:${id}`);
    const combined = AbortSignal.any([signal, probe.signal, this.lifetime.signal]);
    try {
      let failure: unknown;
      const measure = async (direction: 'download' | 'upload') => {
        combined.throwIfAborted();
        if (this.telemetryBusy()) throw Error('DIAGNOSTICS_BUSY');
        try {
          return await measureDiagnostic(this.identity, peer, direction, combined, this.overlay);
        } catch (error) {
          combined.throwIfAborted();
          failure = error;
          return null;
        }
      };
      const downloadMbps = await measure('download');
      const uploadMbps = await measure('upload');
      if (downloadMbps === null && uploadMbps === null) throw failure;
      return { uploadMbps, downloadMbps };
    } finally {
      probe.release();
    }
  }
  private async diagnosticRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const match = request.url?.match(/^\/v1\/diagnostics\/([a-f0-9-]{36})\/(upload|download)$/u);
    const socket = request.socket as TLSSocket;
    const cert = socket.getPeerCertificate();
    const peer = match ? this.incoming.get(match[1]!) : undefined;
    if (
      !this.active ||
      request.method !== 'POST' ||
      !socket.authorized ||
      !cert.raw ||
      !peer ||
      peer.phase !== 'approved' ||
      !peer.localVerified ||
      !peer.remoteVerified ||
      peer.peerFingerprint !== peerFingerprint(cert.raw)
    )
      throw Error('PEER_NOT_APPROVED');
    if (this.telemetryBusy()) throw Error('DIAGNOSTICS_BUSY');
    const probe = this.diagnostics.acquire(`${peer.id}:${match![2]}`);
    try {
      await serveDiagnostic(
        request,
        response,
        match![2] as 'upload' | 'download',
        AbortSignal.any([probe.signal, this.lifetime.signal]),
      );
    } finally {
      probe.release();
    }
  }
  constructor(
    private readonly identity: WindowsPeerIdentity,
    private readonly name: string,
    private gpus: readonly PeerGpu[],
    private readonly rpcBackend?: PeerRpcBackend,
    private readonly timing = { startup: 20000, stop: 25000 },
    private readonly trust?: {
      initial: readonly PeerTrust[];
      save(records: readonly PeerTrust[]): Promise<void>;
    },
    private readonly recordFailure?: (event: PeerFailure) => void,
  ) {
    for (const record of trust?.initial ?? []) {
      const key = `${record.direction}:${record.fingerprint}`;
      this.trusted.set(key, record);
      this.trustReady.add(key);
      if (record.direction === 'outgoing')
        this.outgoing.set(randomUUID(), {
          id: '',
          name: record.name,
          peerFingerprint: record.fingerprint,
          certificate: Buffer.from(record.certificate, 'base64'),
          authority: Buffer.from(record.authority, 'base64'),
          address: record.address!,
          securePort: record.securePort!,
          verified: true,
        });
    }
    for (const [id, peer] of this.outgoing) peer.id = id;
    this.restoreIncomingTrust();
    text(name);
    if (gpus.length > 16 || new Set(gpus.map((gpu) => gpu.id)).size !== gpus.length)
      invalid('INVALID_GPU_INVENTORY');
    for (const gpu of gpus) {
      text(gpu.id, 160);
      text(gpu.name, 160);
      if (!Number.isSafeInteger(gpu.memoryBytes) || gpu.memoryBytes < 0)
        invalid('INVALID_GPU_INVENTORY');
    }
    if (gpus.every((gpu) => /^GPU-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(gpu.id)))
      this.reservations = new GpuReservations(
        gpus.map((gpu) => gpu.id),
        15000,
        () => performance.now(),
      );
  }
  private saveTrust(): Promise<void> {
    const records = [...this.trusted.values()];
    this.trustSaving = this.trustSaving
      .catch(() => undefined)
      .then(() => this.trust?.save(records));
    return this.trustSaving;
  }
  private restoreIncomingTrust(): void {
    for (const record of this.trusted.values()) {
      if (
        record.direction !== 'incoming' ||
        !this.trustReady.has(`incoming:${record.fingerprint}`) ||
        [...this.incoming.values()].some(
          (p) => p.peerFingerprint === record.fingerprint && p.phase === 'approved',
        )
      )
        continue;
      const id = randomUUID();
      this.incoming.set(id, {
        id,
        name: record.name,
        peerFingerprint: record.fingerprint,
        certificate: Buffer.from(record.certificate, 'base64'),
        authority: Buffer.from(record.authority, 'base64'),
        localVerified: true,
        remoteVerified: true,
        phase: 'approved',
        expires: Infinity,
        allowedGpuIds: record.gpuIds,
      });
    }
  }
  private known(direction: PeerTrust['direction'], fingerprint: string): PeerTrust | undefined {
    const key = `${direction}:${fingerprint}`;
    return this.trustReady.has(key) ? this.trusted.get(key) : undefined;
  }
  rememberedAddresses(): string[] {
    return [...this.trusted.values()]
      .filter(
        (p) =>
          p.direction === 'outgoing' &&
          !p.disconnected &&
          this.trustReady.has(`outgoing:${p.fingerprint}`),
      )
      .map((p) => p.address!);
  }
  private allowed(peer: Incoming): PeerGpu[] {
    return this.gpus.filter(
      (g) => this.shared.has(g.id) && (peer.allowedGpuIds?.includes(g.id) ?? false),
    );
  }
  async flushTrust(): Promise<void> {
    await this.trustSaving;
  }
  /** Only trusted parent observations enter here; remote inventory is never applied locally. */
  async updateHardware(input: PeerHardware): Promise<void> {
    const next = decodePeerHardware(input);
    if (this.lifetime.signal.aborted) return;
    if (
      this.gpus.length !== next.gpus.length ||
      this.gpus.some((g) => !next.gpus.some((n) => n.id === g.id))
    )
      ++this.revision;
    this.hardware = next;
    this.gpus = next.gpus.map(({ id, name, memoryBytes }) => ({ id, name, memoryBytes }));
    if (this.reservations) {
      this.reservations.updateDevices(this.gpus.map((g) => g.id));
      this.reservations.setShared(
        [...this.shared].filter((id) => this.gpus.some((g) => g.id === id)),
      );
    } else if (
      this.gpus.every((g) => /^GPU-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(g.id))
    ) {
      this.reservations = new GpuReservations(
        this.gpus.map((g) => g.id),
        15000,
        () => performance.now(),
      );
      this.reservations.setShared(
        [...this.shared].filter((id) => this.gpus.some((g) => g.id === id)),
      );
    }
    this.inventoryChanged();
    const pending = this.reservations?.pendingRelease() ?? [];
    await Promise.all(
      [...this.activeRpc.values()]
        .filter((entry) => pending.includes(entry.reservation))
        .map((entry) => this.stopRpc(entry)),
    );
  }
  private inventoryChanged(): void {
    ++this.inventoryRevision;
    for (const wake of this.inventoryWaiters) wake();
  }
  private async waitInventory(id: string, after: number, socket: TLSSocket): Promise<void> {
    if (after !== this.inventoryRevision) return;
    if (this.pendingWatches.has(id)) return invalid('WATCH_ALREADY_OPEN');
    this.pendingWatches.add(id);
    try {
      await new Promise<void>((resolve) => {
        const finish = () => {
          clearTimeout(timer);
          this.inventoryWaiters.delete(finish);
          socket.off('close', finish);
          resolve();
        };
        const timer = setTimeout(finish, 3000);
        this.inventoryWaiters.add(finish);
        socket.once('close', finish);
      });
    } finally {
      this.pendingWatches.delete(id);
    }
  }
  /** Parent runtime owner only. Release requires its confirmed native exit. */
  reserveLocal(gpuIds: readonly string[]): GpuReservation {
    if (this.lifetime.signal.aborted || this.rpcFailed || !this.reservations)
      throw new Error('NOT_READY');
    if (gpuIds.some((id) => !this.gpus.some((g) => g.id.toLowerCase() === id.toLowerCase())))
      throw Error('GPU_UNAVAILABLE');
    this.diagnostics.cancel();
    return this.reservations.reserveLocal(gpuIds);
  }
  releaseLocal(reservation: GpuReservation): void {
    if (
      reservation.kind !== 'local' ||
      !this.reservations?.beginRelease(reservation) ||
      !this.reservations.confirmReleased(reservation)
    )
      throw new Error('INVALID_GPU_RESERVATION');
  }
  async localResources(): Promise<PeerResources> {
    if (!this.rpcBackend?.resources || this.lifetime.signal.aborted)
      throw Error('RPC_PACKAGE_REQUIRED');
    return this.rpcBackend.resources([]);
  }
  async resources(id: string): Promise<PeerResources> {
    if (!this.outgoing.get(id)?.verified) return invalid('PEER_NOT_APPROVED');
    return decodePeerResources(await this.call(id, 'resources'));
  }
  snapshot() {
    this.expire();
    return {
      fingerprint: this.identity.fingerprint,
      name: this.name,
      sharing: this.active,
      sharedGpuIds: [...this.shared],
      gpus: this.gpus,
      incoming: [...this.incoming.values()].map((value) => ({
        id: value.id,
        name: value.name,
        peerFingerprint: value.peerFingerprint,
        phase: value.phase,
        localVerified: value.localVerified,
        remoteVerified: value.remoteVerified,
        ...(value.phase === 'pending' && !value.remoteVerified && value.pairing
          ? { pairingCode: value.pairing.code }
          : {}),
      })),
      outgoing: [...this.outgoing.values()].map((value) => ({
        id: value.id,
        name: value.name,
        peerFingerprint: value.peerFingerprint,
        verified: value.verified,
        address: value.address,
      })),
    };
  }
  private expire(): void {
    const now = performance.now();
    for (const [id, value] of this.incoming)
      if (value.phase !== 'approved' && value.expires <= now) {
        value.pairing?.close();
        this.incoming.delete(id);
      }
  }
  private refreshTrust(): void {
    this.secure?.setSecureContext({
      pfx: this.identity.pfx,
      ca: [...this.incoming.values()].map((value) =>
        new X509Certificate(value.authority).toString(),
      ),
      minVersion: 'TLSv1.3',
      maxVersion: 'TLSv1.3',
      secureOptions: constants.SSL_OP_NO_TICKET,
    });
  }
  private track(server: Server | SecureServer): void {
    server.maxConnections = 16;
    server.maxHeadersCount = 16;
    server.headersTimeout = 5000;
    server.requestTimeout = 10000;
    server.keepAliveTimeout = 1000;
    server.on('connection', (socket: Socket) => {
      this.sockets.add(socket);
      if (!isOverlaySocket(socket)) socket.setTimeout(10000, () => socket.destroy());
      socket.once('close', () => this.sockets.delete(socket));
    });
    server.on('error', () => {
      this.active = false;
      for (const socket of this.sockets) socket.destroy();
    });
  }
  async share(
    host: string,
    bootstrapPort: number,
    securePort: number,
    selected: readonly string[],
  ): Promise<string> {
    if (
      this.lifetime.signal.aborted ||
      this.active ||
      this.starting ||
      !privateAddress(host) ||
      selected.length > 16 ||
      new Set(selected).size !== selected.length ||
      selected.some((id) => !this.gpus.some((gpu) => gpu.id === id)) ||
      [bootstrapPort, securePort].some(
        (port) => !Number.isInteger(port) || port < 0 || port > 65535,
      )
    )
      return invalid('INVALID_SHARING');
    if (this.rpcFailed) {
      await this.stopSharing();
      if (this.lifetime.signal.aborted) return invalid('SHARING_STOPPED');
    }
    this.starting = true;
    const revision = ++this.revision;
    this.shared = new Set(selected);
    this.inventoryChanged();
    this.reservations?.setShared(selected);
    this.secure = createSecureServer(
      {
        pfx: this.identity.pfx,
        ca: [],
        requestCert: true,
        rejectUnauthorized: true,
        minVersion: 'TLSv1.3',
        maxVersion: 'TLSv1.3',
        secureOptions: constants.SSL_OP_NO_TICKET,
      },
      (request, response) => {
        if (request.url?.startsWith('/v1/diagnostics/')) {
          void this.diagnosticRequest(request, response).catch((error: unknown) => {
            if (response.headersSent) response.destroy();
            else
              reply(
                response,
                { error: error instanceof Error ? error.message : 'PEER_UNAVAILABLE' },
                error instanceof Error && error.message === 'DIAGNOSTICS_BUSY' ? 503 : 403,
              );
          });
          return;
        }
        void this.control(request).then(
          (result) => reply(response, result),
          (error: unknown) =>
            reply(
              response,
              {
                error:
                  error instanceof Error && /^[A-Z_]{1,64}$/u.test(error.message)
                    ? error.message
                    : 'PEER_UNAVAILABLE',
              },
              403,
            ),
        );
      },
    );
    this.bootstrap = createServer({ maxHeaderSize: 8192 }, (request, response) => {
      if (request.method === 'GET' && request.url === '/v1/discover') {
        reply(response, {
          protocol: 1,
          name: this.name,
          fingerprint: this.identity.fingerprint,
          sharing: this.active,
        });
        return;
      }
      void this.introduce(request).then(
        (result) => reply(response, result),
        (error: unknown) =>
          reply(
            response,
            {
              error:
                error instanceof Error && /^[A-Z_]{1,64}$/u.test(error.message)
                  ? error.message
                  : 'INVALID_PEER_MESSAGE',
            },
            403,
          ),
      );
    });
    this.track(this.secure);
    this.track(this.bootstrap);
    this.secure.on('upgrade', (request, socket, head) => {
      const work = this.upgradeRpc(request, socket, head)
        .catch(() => {
          socket.destroy();
        })
        .finally(() => this.rpcPreparations.delete(work));
      this.rpcPreparations.add(work);
    });
    this.secure.on('secureConnection', (socket) => {
      this.sockets.add(socket);
      socket.setTimeout(10000, () => socket.destroy());
      socket.once('close', () => this.sockets.delete(socket));
    });
    try {
      try {
        await this.rpcBackend?.openSharing?.(selected);
      } catch (error) {
        throw Error('RPC_SHARING_FAILED', { cause: error });
      }
      if (revision !== this.revision) return invalid('SHARING_STOPPED');
      this.securePort = await listen(this.secure, host, securePort);
      const port = await listen(this.bootstrap, host, bootstrapPort);
      if (revision !== this.revision) return invalid('SHARING_STOPPED');
      let networkLost = false;
      try {
        await this.rpcBackend?.openNetwork?.(host, () => {
          networkLost = true;
          if (revision !== this.revision) return;
          if (this.active)
            void this.stopSharing().catch(() => {
              this.rpcFailed = true;
            });
        });
      } catch (error) {
        throw Error(
          error instanceof Error && error.message === 'SHARING_FIREWALL_PERMISSION_DENIED'
            ? error.message
            : 'SHARING_FIREWALL_FAILED',
          { cause: error },
        );
      }
      if (revision !== this.revision || networkLost) return invalid('SHARING_STOPPED');
      this.active = true;
      if (this.reservations)
        this.rpcTimer = setInterval(() => {
          const pending = this.reservations!.pendingRelease();
          for (const entry of this.activeRpc.values())
            if (pending.includes(entry.reservation)) {
              if (!entry.closing) entry.trace.event('lease', 'owner-close', { side: 'owner' });
              void this.stopRpc(entry).catch(() => {
                this.rpcFailed = true;
              });
            }
        }, 1000);
      return `http://${host}:${port}/`;
    } catch (error) {
      await this.stopSharing();
      if (
        error instanceof Error &&
        [
          'RPC_SHARING_FAILED',
          'SHARING_FIREWALL_FAILED',
          'SHARING_FIREWALL_PERMISSION_DENIED',
          'SHARING_STOPPED',
        ].includes(error.message)
      )
        throw error;
      return invalid('PEER_UNAVAILABLE');
    } finally {
      this.starting = false;
    }
  }
  private async introduce(request: IncomingMessage): Promise<unknown> {
    this.expire();
    const bootstrap = this.bootstrap;
    if (
      !this.active ||
      request.method !== 'POST' ||
      request.url !== '/v1/pair' ||
      !this.shared.size
    )
      return invalid('NOT_SHARING');
    const now = performance.now();
    this.rate = this.rate.filter((value) => now - value < 60000);
    if (this.rate.length >= 8) return invalid('PAIRING_LIMIT');
    this.rate.push(now);
    const input = object(await body(request), [
      'name',
      'certificate',
      'authority',
      'rememberedFingerprint',
    ]);
    if (
      input.rememberedFingerprint !== null &&
      (typeof input.rememberedFingerprint !== 'string' ||
        !/^[a-f0-9]{64}$/u.test(input.rememberedFingerprint))
    )
      return invalid();
    if (!this.active) return invalid('NOT_SHARING');
    const cert = certificate(input.certificate),
      authority = certificate(input.authority),
      fingerprint = validatePeerCertificate(cert, authority);
    if (fingerprint === this.identity.fingerprint) return invalid('SAME_PEER');
    const remembersReceiver = input.rememberedFingerprint === this.identity.fingerprint;
    const existing = remembersReceiver
      ? [...this.incoming.values()].find(
          (p) => p.peerFingerprint === fingerprint && p.phase === 'approved',
        )
      : undefined;
    if (existing) {
      existing.certificate = cert;
      existing.authority = authority;
      this.refreshTrust();
    }
    if (existing)
      return {
        id: existing.id,
        name: this.name,
        certificate: this.identity.certificate.toString('base64'),
        authority: this.identity.authority.toString('base64'),
        securePort: this.securePort,
        pairing: 'code-v1',
      };
    // Retries can arrive through different addresses or while OPAQUE setup is
    // awaiting initialization. Serialize creation by validated device identity,
    // then reuse its live transcript without extending its verification window.
    while (this.introductions.has(fingerprint)) await this.introductions.get(fingerprint);
    let release!: () => void;
    this.introductions.set(
      fingerprint,
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    try {
      this.expire();
      if (!this.active || this.bootstrap !== bootstrap) return invalid('NOT_SHARING');
      const name = text(input.name);
      let value = [...this.incoming.values()].find(
        (peer) => peer.peerFingerprint === fingerprint && peer.phase === 'pending',
      );
      // Names are bound into the code transcript. A changed name must not
      // silently reuse, replace or reset an in-progress verification attempt.
      if (value && value.name !== name) return invalid('DUPLICATE_PEER_REQUEST');
      if (!value) {
        if (this.incoming.size + this.introductions.size > 8) return invalid('PAIRING_LIMIT');
        value = {
          id: randomUUID(),
          name,
          peerFingerprint: fingerprint,
          certificate: cert,
          authority,
          localVerified: false,
          remoteVerified: false,
          phase: 'pending',
          expires: performance.now() + 300000,
        };
        const known = remembersReceiver ? this.known('incoming', fingerprint) : undefined;
        if (known) {
          value.localVerified = value.remoteVerified = true;
          value.phase = 'approved';
          value.name = known.name;
          value.allowedGpuIds = known.gpuIds;
        } else
          value.pairing = await CodePairing.create({
            id: value.id,
            client: fingerprint,
            server: this.identity.fingerprint,
            clientName: value.name,
            serverName: this.name,
          });
        if (!this.active || this.bootstrap !== bootstrap) {
          value.pairing?.close();
          return invalid('NOT_SHARING');
        }
        this.incoming.set(value.id, value);
        this.refreshTrust();
      }
      return {
        id: value.id,
        name: this.name,
        certificate: this.identity.certificate.toString('base64'),
        authority: this.identity.authority.toString('base64'),
        securePort: this.securePort,
        pairing: 'code-v1',
      };
    } finally {
      this.introductions.delete(fingerprint);
      release();
    }
  }
  private async control(request: IncomingMessage): Promise<unknown> {
    this.expire();
    if (!this.active || request.method !== 'POST') return invalid('NOT_SHARING');
    const socket = request.socket as TLSSocket;
    if (!socket.authorized) return invalid('PEER_NOT_AUTHENTICATED');
    const cert = socket.getPeerCertificate();
    if (!cert.raw) return invalid('PEER_NOT_AUTHENTICATED');
    const fingerprint = peerFingerprint(cert.raw);
    const data = await body(request);
    const scopedHeartbeat =
      request.url === '/v1/heartbeat' &&
      data !== null &&
      typeof data === 'object' &&
      Object.hasOwn(data, 'gpuId');
    const input = object(
      data,
      request.url === '/v1/code-start'
        ? ['id', 'request']
        : request.url === '/v1/code-finish'
          ? ['id', 'attempt', 'proof']
          : request.url === '/v1/diagnostics-activity'
            ? ['id', 'busy']
            : request.url === '/v1/inventory-watch'
              ? ['id', 'after']
              : scopedHeartbeat
                ? ['id', 'gpuId']
                : ['id'],
    );
    this.expire();
    const value = this.incoming.get(text(input.id, 36));
    if (!this.active || !value || value.peerFingerprint !== fingerprint)
      return invalid('UNKNOWN_PEER_REQUEST');
    if (value.phase === 'declined') {
      if (request.url === '/v1/status') return { phase: 'declined' };
      return invalid('PEER_DECLINED');
    }
    if (request.url === '/v1/code-start') {
      if (!value.pairing || value.remoteVerified) return invalid('PAIRING_EXPIRED');
      const now = performance.now();
      this.codeRate = this.codeRate.filter((at) => now - at < 60000);
      if (this.codeRate.length >= 10) return invalid('PAIRING_ATTEMPTS_EXCEEDED');
      this.codeRate.push(now);
      return value.pairing.start(text(input.request, 4096));
    } else if (request.url === '/v1/code-finish') {
      if (!value.pairing || value.remoteVerified) return invalid('PAIRING_EXPIRED');
      const confirmation = value.pairing.finish({
        attempt: text(input.attempt, 36),
        proof: text(input.proof, 4096),
      });
      value.remoteVerified = true;
      if (value.localVerified) value.phase = 'approved';
      this.inventoryChanged();
      return { confirmation };
    } else if (request.url === '/v1/cancel') {
      await this.decline(value.id);
    } else if (request.url === '/v1/inventory-watch') {
      if (value.phase !== 'approved' || !value.localVerified || !value.remoteVerified)
        return invalid('PEER_NOT_APPROVED');
      if (!Number.isSafeInteger(input.after) || (input.after as number) < -1) return invalid();
      await this.waitInventory(value.id, input.after as number, socket);
      if (
        !this.active ||
        value.phase !== 'approved' ||
        !value.localVerified ||
        !value.remoteVerified
      )
        return invalid('PEER_NOT_APPROVED');
      return {
        revision: this.inventoryRevision,
        gpus: this.allowed(value),
        ...(this.hardware
          ? {
              hardware: {
                ...this.hardware,
                gpus: this.hardware.gpus.filter((g) =>
                  this.allowed(value).some((p) => p.id === g.id),
                ),
              },
            }
          : {}),
      };
    } else if (request.url === '/v1/inventory') {
      if (value.phase !== 'approved') return invalid('PEER_NOT_APPROVED');
      return this.allowed(value);
    } else if (request.url === '/v1/diagnostics-ping') {
      if (value.phase !== 'approved' || !value.localVerified || !value.remoteVerified)
        return invalid('PEER_NOT_APPROVED');
      return { idle: !this.telemetryBusy() };
    } else if (request.url === '/v1/diagnostics-activity') {
      if (
        value.phase !== 'approved' ||
        !value.localVerified ||
        !value.remoteVerified ||
        typeof input.busy !== 'boolean'
      )
        return invalid('PEER_NOT_APPROVED');
      const ownsStream = [...this.activeRpc.values()].some((entry) => entry.id === value.id);
      if (input.busy && !ownsStream) return invalid('RPC_NOT_APPROVED');
      if (input.busy) {
        this.remoteRuntimeBusy.set(value.id, true);
        this.diagnostics.cancel();
      } else {
        this.remoteRuntimeBusy.delete(value.id);
        for (const entry of this.activeRpc.values())
          if (entry.id === value.id) this.rpcLoading.delete(entry.reservation);
      }
      return { phase: 'approved' };
    } else if (request.url === '/v1/resources') {
      if (value.phase !== 'approved' || !this.rpcBackend?.resources)
        return invalid('RPC_PACKAGE_REQUIRED');
      const revision = this.revision;
      const result = await this.rpcBackend.resources(this.allowed(value).map((g) => g.id));
      if (!this.active || revision !== this.revision || value.phase !== 'approved')
        return invalid('SHARING_STOPPED');
      return result;
    } else if (request.url === '/v1/heartbeat') {
      const gpuId = scopedHeartbeat ? text(input.gpuId, 40).toLowerCase() : undefined;
      const entries = [...this.activeRpc.values()].filter(
        (entry) =>
          entry.id === value.id &&
          (gpuId === undefined || entry.reservation.gpuUuids[0]!.toLowerCase() === gpuId),
      );
      if (
        value.phase !== 'approved' ||
        (gpuId === undefined && this.allowed(value).length !== 1) ||
        entries.length !== 1 ||
        !this.reservations?.renew(entries[0]!.reservation)
      ) {
        for (const entry of entries)
          entry.trace.event('lease', 'error', { error: Error('RPC_LEASE_EXPIRED'), side: 'owner' });
        return invalid('RPC_LEASE_EXPIRED');
      }
    } else if (request.url !== '/v1/status') return invalid('UNKNOWN_PEER_OPERATION');
    return { phase: value.phase };
  }
  async invite(
    input: string,
    expectedFingerprint?: string,
    connectedIds: readonly string[] = [],
  ): Promise<Readonly<{ id: string; peerFingerprint: string; alreadyConnected?: true }>> {
    if (this.lifetime.signal.aborted) return invalid('PEER_UNAVAILABLE');
    if (this.invitations >= 8) return invalid('PAIRING_LIMIT');
    ++this.invitations;
    try {
      const address = peerAddress(input);
      const knownPeers = [...this.trusted.values()].filter(
        (peer) =>
          peer.direction === 'outgoing' && this.trustReady.has(`outgoing:${peer.fingerprint}`),
      );
      let remembered = knownPeers.find(
        (peer) => peer.fingerprint === expectedFingerprint || peer.address === address.hostname,
      );
      if (
        remembered &&
        expectedFingerprint !== undefined &&
        remembered.fingerprint !== expectedFingerprint
      )
        return invalid('PEER_IDENTITY_CHANGED');
      if (!remembered && expectedFingerprint === undefined && knownPeers.length) {
        // Public discovery only locates an existing pin. It never grants trust.
        const discovery = object(
          await exchange(
            new URL('/v1/discover', address),
            {},
            undefined,
            undefined,
            this.lifetime.signal,
            undefined,
            this.overlay,
            5000,
            'GET',
          ),
          ['protocol', 'name', 'fingerprint', 'sharing'],
        );
        if (
          discovery.protocol !== 1 ||
          typeof discovery.sharing !== 'boolean' ||
          typeof discovery.fingerprint !== 'string' ||
          !/^[a-f0-9]{64}$/u.test(discovery.fingerprint)
        )
          return invalid('INVALID_PEER_MESSAGE');
        remembered = knownPeers.find((peer) => peer.fingerprint === discovery.fingerprint);
      }
      const existing =
        remembered &&
        [...this.outgoing.values()].find(
          (peer) =>
            peer.peerFingerprint === remembered.fingerprint &&
            peer.verified &&
            !this.isDisconnected(peer.id) &&
            connectedIds.includes(peer.id),
        );
      if (existing) {
        try {
          // Prove the entered address owns the pinned key, using mutual TLS and
          // the existing approved request. Keep the working route untouched.
          const status = object(
            await exchange(
              new URL(`https://${address.hostname}:${existing.securePort}/v1/status`),
              { id: existing.id },
              this.identity,
              existing.certificate,
              this.lifetime.signal,
              existing.authority,
              this.overlay,
            ),
            ['phase'],
          );
          if (status.phase === 'approved')
            return Object.freeze({
              id: existing.id,
              peerFingerprint: existing.peerFingerprint,
              alreadyConnected: true as const,
            });
          return invalid('PEER_NOT_APPROVED');
        } catch (error) {
          // A restarted peer can retain approval with a new request ID.
          if (!(error instanceof Error) || error.message !== 'UNKNOWN_PEER_REQUEST') throw error;
        }
      }
      const response = object(
        await exchange(
          new URL('/v1/pair', address),
          {
            name: this.name,
            certificate: this.identity.certificate.toString('base64'),
            authority: this.identity.authority.toString('base64'),
            rememberedFingerprint:
              remembered?.fingerprint ??
              [...this.trusted.values()].find(
                (p) =>
                  p.direction === 'outgoing' &&
                  (p.address === address.hostname || p.fingerprint === expectedFingerprint) &&
                  this.trustReady.has(`outgoing:${p.fingerprint}`),
              )?.fingerprint ??
              null,
          },
          undefined,
          undefined,
          this.lifetime.signal,
          undefined,
          this.overlay,
        ),
        ['id', 'name', 'certificate', 'authority', 'securePort', 'pairing'],
      );
      if (this.lifetime.signal.aborted) return invalid('PEER_UNAVAILABLE');
      const cert = certificate(response.certificate),
        authority = certificate(response.authority),
        fingerprint = validatePeerCertificate(cert, authority);
      const expected = expectedFingerprint ?? remembered?.fingerprint;
      if (expected !== undefined && fingerprint !== expected)
        return invalid('PEER_IDENTITY_CHANGED');
      const id = text(response.id, 36);
      if (response.pairing !== 'code-v1') return invalid('PAIRING_UPDATE_REQUIRED');
      if (
        !/^[a-f0-9-]{36}$/u.test(id) ||
        fingerprint === this.identity.fingerprint ||
        !Number.isInteger(response.securePort) ||
        (response.securePort as number) < 1024 ||
        (response.securePort as number) > 65535
      )
        return invalid();
      if (this.outgoing.has(id) && this.outgoing.get(id)?.peerFingerprint !== fingerprint)
        return invalid('DUPLICATE_PEER_REQUEST');
      if (
        this.outgoing.size >= 8 &&
        ![...this.outgoing.values()].some((p) => p.peerFingerprint === fingerprint)
      )
        return invalid('PAIRING_LIMIT');
      const known = this.known('outgoing', fingerprint);
      const previous = [...this.trusted.values()].find(
        (p) => p.direction === 'outgoing' && p.address === address.hostname,
      );
      if (previous && previous.fingerprint !== fingerprint) return invalid('PEER_IDENTITY_CHANGED');
      if (known?.disconnected) {
        const resumed = { ...known };
        delete resumed.disconnected;
        this.trusted.set(`outgoing:${fingerprint}`, resumed);
        try {
          await this.saveTrust();
        } catch (error) {
          this.trusted.set(`outgoing:${fingerprint}`, known);
          throw error;
        }
      }
      const current = this.outgoing.get(id);
      if (current) {
        // Retain a code verification already completed for this exact request,
        // including an in-flight verifier's object identity and original expiry.
        current.address = address.hostname;
        current.certificate = cert;
        current.authority = authority;
        current.securePort = response.securePort as number;
        return Object.freeze({ id, peerFingerprint: fingerprint });
      }
      for (const [key, peer] of this.outgoing)
        if (peer.peerFingerprint === fingerprint) this.outgoing.delete(key);
      this.outgoing.set(id, {
        id,
        name: text(response.name),
        peerFingerprint: fingerprint,
        certificate: cert,
        authority,
        securePort: response.securePort as number,
        address: address.hostname,
        verified: !!known,
        expires: performance.now() + 300000,
      });
      return Object.freeze({ id, peerFingerprint: fingerprint });
    } finally {
      --this.invitations;
    }
  }
  approve(id: string, fingerprint: string): Promise<void> {
    return Promise.resolve().then(async () => {
      this.expire();
      const value = this.incoming.get(id);
      if (!this.active || !value || value.phase === 'declined')
        return invalid('UNKNOWN_PEER_REQUEST');
      if (fingerprint !== value.peerFingerprint) return invalid('FINGERPRINT_MISMATCH');
      if (value.pairing && !value.remoteVerified) return invalid('PAIRING_NOT_VERIFIED');
      const key = `incoming:${fingerprint}`;
      const sharingRevision = this.revision;
      value.allowedGpuIds = [...this.shared];
      this.trusted.set(key, {
        direction: 'incoming',
        fingerprint,
        name: value.name,
        certificate: value.certificate.toString('base64'),
        authority: value.authority.toString('base64'),
        gpuIds: [...value.allowedGpuIds],
      });
      try {
        await this.saveTrust();
      } catch {
        this.trusted.delete(key);
        this.trustReady.delete(key);
        throw Error('PEER_TRUST_UNAVAILABLE');
      }
      if (
        !this.active ||
        this.revision !== sharingRevision ||
        performance.now() >= value.expires ||
        this.incoming.get(id) !== value ||
        this.incoming.get(id)?.phase === 'declined'
      ) {
        this.trusted.delete(key);
        await this.saveTrust();
        throw Error('PAIRING_EXPIRED');
      }
      this.trustReady.add(key);
      value.localVerified = true;
      if (value.remoteVerified) value.phase = 'approved';
    });
  }
  async decline(id: string): Promise<void> {
    this.diagnostics.cancel();
    const value = this.incoming.get(id);
    if (!value) return invalid('UNKNOWN_PEER_REQUEST');
    value.phase = 'declined';
    const key = `incoming:${value.peerFingerprint}`;
    this.trusted.delete(key);
    this.trustReady.delete(key);
    for (const peer of this.incoming.values())
      if (peer.peerFingerprint === value.peerFingerprint) {
        peer.phase = 'declined';
        peer.localVerified = peer.remoteVerified = false;
        peer.pairing?.close();
      }
    value.pairing?.close();
    this.inventoryChanged();
    value.localVerified = value.remoteVerified = false;
    for (const entry of this.activeRpc.values())
      if (this.incoming.get(entry.id)?.peerFingerprint === value.peerFingerprint)
        void this.stopRpc(entry).catch(() => {
          this.rpcFailed = true;
        });
    await this.saveTrust();
  }
  private async call(
    id: string,
    operation: string,
    data: object = {},
    signal?: AbortSignal,
  ): Promise<unknown> {
    const value = this.outgoing.get(id);
    if (!value) return invalid('UNKNOWN_PEER_REQUEST');
    if (this.isDisconnected(id)) return invalid('PEER_DISCONNECTED');
    let requestLifetime = this.outgoingRequests.get(value);
    if (!requestLifetime || requestLifetime.signal.aborted) {
      requestLifetime = new AbortController();
      this.outgoingRequests.set(value, requestLifetime);
    }
    const admittedLifetime = requestLifetime;
    const result = await exchange(
      new URL(`https://${value.address}:${value.securePort}/v1/${operation}`),
      { id, ...data },
      this.identity,
      value.certificate,
      AbortSignal.any([this.lifetime.signal, requestLifetime.signal, ...(signal ? [signal] : [])]),
      value.authority,
      this.overlay,
      // The server deliberately holds an unchanged inventory for three seconds.
      operation === 'inventory-watch' ? 10000 : 5000,
    ).catch((error: unknown) => {
      if (admittedLifetime.signal.aborted) return invalid('PEER_DISCONNECTED');
      throw error;
    });
    if (
      requestLifetime.signal.aborted ||
      this.outgoing.get(id) !== value ||
      this.isDisconnected(id)
    )
      return invalid('PEER_DISCONNECTED');
    return result;
  }
  confirm(id: string, fingerprint: string): Promise<void> {
    // Legacy in-process callers cannot bypass the new out-of-band verification.
    void id;
    void fingerprint;
    return Promise.reject(Error('PAIRING_CODE_REQUIRED'));
  }
  async verifyCode(id: string, code: string): Promise<void> {
    const value = this.outgoing.get(id);
    if (!value || value.verified) return invalid('UNKNOWN_PEER_REQUEST');
    if ((value.expires ?? 0) <= performance.now()) return invalid('PAIRING_EXPIRED');
    const proof = await verifyPairingCode(
      {
        id,
        client: this.identity.fingerprint,
        server: value.peerFingerprint,
        clientName: this.name,
        serverName: value.name,
      },
      code,
      async (request) => {
        const result = object(await this.call(id, 'code-start', { request }), [
          'attempt',
          'response',
        ]);
        return { attempt: text(result.attempt, 36), response: text(result.response, 4096) };
      },
    );
    const result = object(
      await this.call(id, 'code-finish', { attempt: proof.attempt, proof: proof.proof }),
      ['confirmation'],
    );
    proof.accept(text(result.confirmation, 64));
    if (this.lifetime.signal.aborted || this.outgoing.get(id) !== value)
      return invalid('PAIRING_EXPIRED');
    value.verified = true;
  }
  isDisconnected(id: string): boolean {
    const peer = this.outgoing.get(id);
    return !!peer && this.trusted.get(`outgoing:${peer.peerFingerprint}`)?.disconnected === true;
  }
  /** Retain trust but stop admission, reads and RPC for this worker until an explicit invite. */
  async disconnect(id: string): Promise<void> {
    const peer = this.outgoing.get(id);
    if (!peer) return invalid('UNKNOWN_PEER_REQUEST');
    const key = `outgoing:${peer.peerFingerprint}`;
    const known = this.known('outgoing', peer.peerFingerprint);
    if (!peer.verified || !known) return invalid('PEER_NOT_APPROVED');
    this.trusted.set(key, { ...known, disconnected: true });
    this.outgoingRequests.get(peer)?.abort();
    this.diagnostics.cancel();
    for (const [socket, requestId] of this.outgoingRpc) if (requestId === id) socket.destroy();
    // A failed save keeps this session disconnected and reports persistence failure.
    await this.saveTrust();
  }
  async cancel(id: string): Promise<void> {
    this.diagnostics.cancel();
    this.rpcTraffic.delete(id);
    this.remoteIdle.delete(id);
    this.diagnosticsUnsupported.delete(id);
    const value = this.outgoing.get(id);
    if (!value) return invalid('UNKNOWN_PEER_REQUEST');
    this.outgoing.delete(id);
    const key = `outgoing:${value.peerFingerprint}`;
    this.trusted.delete(key);
    this.trustReady.delete(key);
    await this.saveTrust();
    try {
      await exchange(
        new URL(`https://${value.address}:${value.securePort}/v1/cancel`),
        { id },
        this.identity,
        value.certificate,
        this.lifetime.signal,
        value.authority,
        this.overlay,
      );
    } catch {
      /* Local cancellation never waits for an unreachable peer. */
    }
  }
  async status(id: string): Promise<{ phase: Phase }> {
    const result = object(await this.call(id, 'status'), ['phase']);
    if (!['pending', 'approved', 'declined'].includes(result.phase as string)) return invalid();
    const peer = this.outgoing.get(id);
    if (peer) {
      const key = `outgoing:${peer.peerFingerprint}`;
      if (result.phase === 'declined') {
        this.trusted.delete(key);
        this.trustReady.delete(key);
        await this.saveTrust();
      } else if (result.phase === 'pending' && this.trustReady.has(key)) {
        this.trusted.delete(key);
        this.trustReady.delete(key);
        peer.verified = false;
        await this.saveTrust();
      } else if (result.phase === 'approved' && peer.verified && !this.trustReady.has(key)) {
        this.trusted.set(key, {
          direction: 'outgoing',
          fingerprint: peer.peerFingerprint,
          name: peer.name,
          certificate: peer.certificate.toString('base64'),
          authority: peer.authority.toString('base64'),
          gpuIds: [],
          address: peer.address,
          securePort: peer.securePort,
        });
        let saving = this.trustPending.get(key);
        if (!saving) {
          saving = this.saveTrust();
          this.trustPending.set(key, saving);
        }
        try {
          await saving;
        } catch {
          this.trusted.delete(key);
          peer.verified = false;
          throw Error('PEER_TRUST_UNAVAILABLE');
        } finally {
          if (this.trustPending.get(key) === saving) this.trustPending.delete(key);
        }
        if (this.lifetime.signal.aborted || this.outgoing.get(id) !== peer)
          return invalid('PEER_UNAVAILABLE');
        this.trustReady.add(key);
      }
    }
    return { phase: result.phase as Phase };
  }
  async inventory(id: string): Promise<readonly PeerGpu[]> {
    if (!this.outgoing.get(id)?.verified) return invalid('PEER_NOT_APPROVED');
    const result = await this.call(id, 'inventory');
    if (!Array.isArray(result) || result.length > 16) return invalid();
    return result.map((value: unknown) => {
      const gpu = object(value, ['id', 'name', 'memoryBytes']);
      if (!Number.isSafeInteger(gpu.memoryBytes) || (gpu.memoryBytes as number) < 0)
        return invalid();
      return {
        id: text(gpu.id, 160),
        name: text(gpu.name, 160),
        memoryBytes: gpu.memoryBytes as number,
      };
    });
  }
  /** Compatibility reads still require the existing mutual approval and GPU sharing checks. */
  async basicInventory(
    id: string,
  ): Promise<{ revision: number; gpus: readonly PeerGpu[]; address: string }> {
    const peer = this.outgoing.get(id);
    if (!peer?.verified || (await this.status(id)).phase !== 'approved')
      return invalid('PEER_NOT_APPROVED');
    const gpus = await this.inventory(id);
    return { revision: 0, gpus, address: peer.address };
  }
  /** One bounded long-poll per approved peer. Rechecking after wake prevents revocation races. */
  async watchInventory(
    id: string,
    after: number,
  ): Promise<{
    revision: number;
    gpus: readonly PeerGpu[];
    hardware?: PeerHardware;
    address: string;
  }> {
    const peer = this.outgoing.get(id);
    if (!peer?.verified) return invalid('PEER_NOT_APPROVED');
    const input = await this.call(id, 'inventory-watch', { after });
    const value = object(input, [
      'revision',
      'gpus',
      ...(input && typeof input === 'object' && Object.hasOwn(input, 'hardware')
        ? ['hardware']
        : []),
    ]);
    if (
      !Number.isSafeInteger(value.revision) ||
      (value.revision as number) < 0 ||
      !Array.isArray(value.gpus) ||
      value.gpus.length > 16
    )
      return invalid();
    const gpus = value.gpus.map((input) => {
      const gpu = object(input, ['id', 'name', 'memoryBytes']);
      if (!Number.isSafeInteger(gpu.memoryBytes) || (gpu.memoryBytes as number) < 0)
        return invalid();
      return {
        id: text(gpu.id, 160),
        name: text(gpu.name, 160),
        memoryBytes: gpu.memoryBytes as number,
      };
    });
    const hardware = value.hardware !== undefined ? decodePeerHardware(value.hardware) : undefined;
    if (
      hardware?.gpus.some(
        (g) => !gpus.some((shared) => shared.id === g.id && shared.memoryBytes === g.memoryBytes),
      )
    )
      return invalid();
    return {
      revision: value.revision as number,
      gpus,
      ...(hardware ? { hardware } : {}),
      address: peer.address,
    };
  }
  private async upgradeRpc(request: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    const tls = request.socket as TLSSocket;
    const id = request.url?.match(/^\/v1\/rpc\/([a-f0-9-]{36})$/u)?.[1];
    const cert = tls.getPeerCertificate();
    const peer = id ? this.incoming.get(id) : undefined;
    if (
      !this.active ||
      this.rpcFailed ||
      !this.rpcBackend ||
      !this.reservations ||
      request.method !== 'POST' ||
      request.headers.upgrade !== 'ModelLoom-RPC/1' ||
      !tls.authorized ||
      !cert.raw ||
      !peer ||
      peer.phase !== 'approved' ||
      peer.peerFingerprint !== peerFingerprint(cert.raw) ||
      head.length > 16384
    ) {
      socket.destroy();
      return;
    }
    await Promise.all(
      [...this.activeRpc.values()].flatMap((entry) => (entry.closing ? [entry.closing] : [])),
    );
    if (this.rpcFailed || !this.active || peer.phase !== 'approved') {
      socket.destroy();
      return;
    }
    // A selector is an authenticated request for a physical GPU, never an ordinal
    // or authority to widen saved sharing scope. Legacy requests are unambiguous
    // only when exactly one GPU is allowed.
    const allowed = this.allowed(peer);
    const selector = request.headers['x-modelloom-gpu'];
    const gpu =
      selector === undefined && allowed.length === 1
        ? allowed[0]
        : typeof selector === 'string'
          ? allowed.find((item) => item.id.toLowerCase() === selector.toLowerCase())
          : undefined;
    if (!gpu || !/^GPU-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(gpu.id)) {
      socket.destroy();
      return;
    }
    this.diagnostics.cancel();
    // Only an authenticated, approved request may wait for the native launch
    // budget. Unapproved connections retain the shorter admission deadline.
    tls.setTimeout(this.timing.startup + 1000);
    // Both the raw TCP socket and its TLS wrapper are tracked. Extending only
    // TLS leaves the raw admission timer able to destroy an approved startup.
    const transports = [...this.sockets].filter(
      (candidate) =>
        candidate === tls ||
        (typeof tls.localPort === 'number' &&
          typeof tls.remotePort === 'number' &&
          typeof tls.remoteAddress === 'string' &&
          candidate.localPort === tls.localPort &&
          candidate.remotePort === tls.remotePort &&
          candidate.remoteAddress === tls.remoteAddress),
    );
    if (!transports.length) throw new Error('RPC_UNAVAILABLE');
    for (const transport of transports) transport.setTimeout(this.timing.startup + 1000);
    const revision = this.revision;
    const traceHeader = request.headers['x-modelloom-rpc-trace'];
    const trace = rpcDiagnostics(
      'worker',
      undefined,
      typeof traceHeader === 'string' ? traceHeader : undefined,
    );
    trace.event('worker-start', 'begin');
    let reservation: GpuReservation;
    try {
      reservation = this.reservations.reserveRemote(peer.peerFingerprint, [gpu.id]);
    } catch (error) {
      trace.event('worker-start', 'error', { error });
      throw error;
    }
    let owned: OwnedPeerRpc;
    let starting = true;
    // Admission has its own bounded startup budget. Keep this exact reservation
    // alive while the authenticated request waits; never revive a releasing lease.
    const startupLease = setInterval(() => {
      if (
        this.active &&
        revision === this.revision &&
        !socket.destroyed &&
        peer.phase === 'approved'
      )
        this.reservations!.renew(reservation);
    }, 3000);
    const cache = request.headers['x-modelloom-tensor-cache'];
    const opening = Promise.resolve().then(() =>
      cache === '1'
        ? this.rpcBackend!.start(reservation.gpuUuids, true, peer.peerFingerprint)
        : this.rpcBackend!.start(reservation.gpuUuids),
    );
    void opening.then(
      (late) => {
        if (!starting)
          void late.close().catch(() => {
            this.rpcFailed = true;
          });
      },
      () => undefined,
    );
    try {
      owned = await peerDeadline(opening, this.timing.startup, 'RPC_START_TIMEOUT');
    } catch (error) {
      trace.event('worker-start', 'error', { error });
      starting = false;
      this.reservations.beginRelease(reservation);
      // A failed backend startup must itself prove teardown before rejecting.
      this.rpcFailed = true;
      throw error;
    } finally {
      clearInterval(startupLease);
    }
    if (
      !this.active ||
      this.rpcFailed ||
      revision !== this.revision ||
      socket.destroyed ||
      peer.phase !== 'approved' ||
      !this.reservations.renew(reservation)
    ) {
      this.reservations.beginRelease(reservation);
      try {
        await peerDeadline(owned.close(), this.timing.stop, 'RPC_CLEANUP_FAILED');
      } catch (error) {
        this.rpcFailed = true;
        throw error;
      }
      this.reservations.confirmReleased(reservation);
      socket.destroy();
      return;
    }
    const entry: ActiveRpc = { id: peer.id, socket, owned, reservation, trace };
    trace.event('worker-start', 'ready');
    this.activeRpc.set(reservation, entry);
    this.rpcLoading.add(reservation);
    tls.setTimeout(0);
    for (const transport of transports) transport.setTimeout(0);
    const residency =
      this.rpcBackend.inputResidency === true &&
      request.headers[RPC_RESIDENCY_HEADER] === RPC_RESIDENCY_VERSION;
    const channel = residency ? rpcResidencyStream(owned.stream, 'worker') : owned.stream;
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: ModelLoom-RPC/1\r\n' +
        (residency ? `${RPC_RESIDENCY_HEADER}: ${RPC_RESIDENCY_VERSION}\r\n` : '') +
        '\r\n',
    );
    if (head.length) socket.unshift(head);
    const stop = () => {
      void this.stopRpc(entry).catch(() => {
        this.rpcFailed = true;
      });
    };
    let firstSide: 'local' | 'remote' | 'owner' | undefined;
    const closed = (side: 'local' | 'remote', error?: unknown) => {
      firstSide ??= entry.closing ? 'owner' : side;
      trace.event('forwarding', error ? 'error' : 'close', {
        side: firstSide,
        ...(error ? { error } : {}),
      });
      stop();
    };
    socket.once('end', () => {
      firstSide ??= 'remote';
      trace.event('forwarding', 'end', { side: firstSide });
    });
    socket.once('close', () => closed('remote'));
    socket.once('error', (error) => closed('remote', error));
    if (residency) {
      socket.once('close', () => channel.destroy());
      channel.once('close', () => closed('local'));
      channel.once('error', (error) => closed('local', error));
    }
    owned.stream.once('end', () => {
      firstSide ??= 'local';
      trace.event('forwarding', 'end', { side: firstSide });
    });
    owned.stream.once('close', () => closed('local'));
    owned.stream.once('error', (error) => closed('local', error));
    socket.pipe(channel);
    channel.pipe(socket);
  }
  private stopRpc(entry: ActiveRpc): Promise<void> {
    if (entry.closing) return entry.closing;
    entry.trace.event('forwarding', 'owner-close', { side: 'owner' });
    this.reservations!.beginRelease(entry.reservation);
    // Publish the guard before destroy/close can synchronously notify the owner again.
    entry.closing = Promise.resolve().then(async () => {
      entry.socket.destroy();
      await peerDeadline(entry.owned.close(), this.timing.stop, 'RPC_CLEANUP_FAILED');
      this.reservations!.confirmReleased(entry.reservation);
      this.activeRpc.delete(entry.reservation);
      this.rpcLoading.delete(entry.reservation);
      if (![...this.activeRpc.values()].some((other) => other.id === entry.id))
        this.remoteRuntimeBusy.delete(entry.id);
    });
    void entry.closing.catch(() => {
      this.rpcFailed = true;
    });
    return entry.closing;
  }
  /** Bind a stream and its lease to one physical shared GPU. Omitting gpuId is
   * retained for older callers only when the remote scope contains one GPU. */
  async openRpc(id: string, gpuId?: string): Promise<Duplex> {
    const trace = rpcDiagnostics('client');
    let phase: 'status' | 'upgrade' = 'status';
    trace.event(phase, 'begin');
    this.diagnostics.cancel();
    ++this.openingRpc;
    try {
      const peer = this.outgoing.get(id);
      if (!peer?.verified || (await this.status(id)).phase !== 'approved')
        return invalid('PEER_NOT_APPROVED');
      trace.event('status', 'ready');
      phase = 'upgrade';
      const admission = this.outgoingRequests.get(peer);
      const socket = await connectPeerRpc(
        this.identity,
        peer,
        admission
          ? AbortSignal.any([this.lifetime.signal, admission.signal])
          : this.lifetime.signal,
        gpuId,
        this.overlay,
        (await this.rpcBackend?.cacheEnabled?.()) ?? false,
        trace,
      ).catch((error: unknown) => {
        if (admission?.signal.aborted) return invalid('PEER_UNAVAILABLE');
        throw error;
      });
      if (
        this.lifetime.signal.aborted ||
        admission?.signal.aborted ||
        this.isDisconnected(id) ||
        this.outgoing.get(id) !== peer
      ) {
        socket.destroy();
        return invalid('PEER_UNAVAILABLE');
      }
      this.outgoingRpc.set(socket, id);
      let traffic = this.rpcTraffic.get(id);
      if (!traffic) {
        traffic = { sent: 0, received: 0, streams: new Map() };
        this.rpcTraffic.set(id, traffic);
      }
      const base = { read: (socket as Socket).bytesRead, written: (socket as Socket).bytesWritten };
      traffic.streams.set(socket, base);
      let checkingHeartbeat = false,
        missedHeartbeats = 0;
      const heartbeat = setInterval(() => {
        if (checkingHeartbeat || socket.destroyed) return;
        checkingHeartbeat = true;
        void this.call(id, 'heartbeat', gpuId === undefined ? {} : { gpuId })
          .then(
            () => {
              missedHeartbeats = 0;
            },
            (error: unknown) => {
              // The worker's independent 15-second lease remains authoritative.
              const close = !isTransientPeerFailure(error) || ++missedHeartbeats >= 2;
              trace.event('lease', 'error', {
                error,
                ...(close ? { side: 'owner' as const } : {}),
              });
              this.recordFailure?.({
                stage: 'heartbeat',
                decision: close ? 'close' : 'retry',
                error,
              });
              if (close) socket.destroy();
            },
          )
          .finally(() => {
            checkingHeartbeat = false;
          });
      }, 3000);
      socket.once('close', () => {
        this.recordFailure?.({
          stage: 'rpc-close',
          decision: 'close',
          error: Error('RPC_STREAM_CLOSED'),
        });
        traffic.sent += Math.max(0, (socket as Socket).bytesWritten - base.written);
        traffic.received += Math.max(0, (socket as Socket).bytesRead - base.read);
        traffic.streams.delete(socket);
        clearInterval(heartbeat);
        this.outgoingRpc.delete(socket);
      });
      socket.once('error', (error: Error) => {
        this.recordFailure?.({
          stage: 'rpc-close',
          decision: 'close',
          error: new Error('PEER_UNAVAILABLE', { cause: error }),
        });
        clearInterval(heartbeat);
        socket.destroy();
      });
      return socket;
    } catch (error) {
      trace.event(phase, 'error', { error });
      throw error;
    } finally {
      --this.openingRpc;
    }
  }
  async stopSharing(): Promise<void> {
    this.diagnostics.cancel();
    this.active = false;
    this.inventoryChanged();
    ++this.revision;
    if (this.rpcTimer) clearInterval(this.rpcTimer);
    this.reservations?.setShared([]);
    for (const socket of this.sockets) socket.destroy();
    let workerFailure: Error | undefined;
    try {
      await peerDeadline(
        Promise.all([...this.rpcPreparations]),
        this.timing.startup + 1000,
        'RPC_START_TIMEOUT',
      );
      try {
        const results = await Promise.allSettled(
          [...this.activeRpc.values()].map((entry) => this.stopRpc(entry)),
        );
        const failure = results.find((result) => result.status === 'rejected');
        if (failure?.status === 'rejected') throw failure.reason;
      } catch (error) {
        workerFailure =
          error instanceof Error ? error : Error('RPC_CLEANUP_FAILED', { cause: error });
      }
    } finally {
      for (const peer of this.incoming.values()) peer.pairing?.close();
      this.incoming.clear();
      this.restoreIncomingTrust();
      this.shared.clear();
      const servers = [this.bootstrap, this.secure];
      this.bootstrap = this.secure = undefined;
      await peerDeadline(
        Promise.all([
          ...servers.map((server) =>
            server
              ? new Promise<void>((resolve) => server.close(() => resolve()))
              : Promise.resolve(),
          ),
          this.rpcBackend?.closeSharing?.(),
        ]),
        this.timing.stop,
        'PEER_STOP_TIMEOUT',
      );
    }
    if (workerFailure && !this.rpcBackend?.closeSharing) throw workerFailure;
    if (this.rpcBackend?.closeSharing) {
      // Full helper cleanup proves all remote workers and their guards are gone.
      for (const reservation of this.reservations?.pendingRelease() ?? [])
        if (reservation.kind === 'remote') this.reservations!.confirmReleased(reservation);
      this.activeRpc.clear();
      this.rpcFailed = false;
    }
  }
  async close(): Promise<void> {
    this.diagnostics.cancel();
    this.lifetime.abort();
    for (const socket of this.outgoingRpc.keys()) socket.destroy();
    this.outgoingRpc.clear();
    await this.stopSharing();
    this.outgoing.clear();
  }
}
