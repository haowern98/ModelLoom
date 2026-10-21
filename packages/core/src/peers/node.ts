import { createServer, request as httpRequest } from 'node:http';
import type { IncomingMessage, ServerResponse, Server } from 'node:http';
import { createServer as createSecureServer, request as secureRequest } from 'node:https';
import type { Server as SecureServer } from 'node:https';
import { constants, randomUUID, X509Certificate } from 'node:crypto';
import type { Socket } from 'node:net';
import type { TLSSocket } from 'node:tls';
import { peerFingerprint, validatePeerCertificate } from './windows-identity.js';
import type { WindowsPeerIdentity } from './windows-identity.js';
import { connectPeerRpc } from './rpc.js';
import type { OwnedPeerRpc, PeerRpcBackend } from './rpc.js';
import type { Duplex } from 'node:stream';
import { GpuReservations } from './reservations.js';
import type { GpuReservation } from './reservations.js';
import { decodePeerAddress, privatePeerHost as privateAddress } from './wire.js';
import { peerDeadline } from './deadline.js';
import { decodePeerResources } from './resources.js';
import type { PeerResources } from './resources.js';

export interface PeerGpu {
  readonly id: string;
  readonly name: string;
  readonly memoryBytes: number;
}
type Phase = 'pending' | 'approved' | 'declined';
interface Incoming {
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
async function body(request: IncomingMessage): Promise<unknown> {
  let bytes = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    bytes += value.length;
    if (bytes > 16384) return invalid('PEER_MESSAGE_TOO_LARGE');
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}
function reply(response: ServerResponse, value: unknown, status = 200): void {
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    Connection: 'close',
  });
  response.end(JSON.stringify(value));
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
function exchange(
  url: URL,
  data: unknown,
  identity?: WindowsPeerIdentity,
  remote?: Buffer,
  signal?: AbortSignal,
  authority?: Buffer,
): Promise<unknown> {
  if (Boolean(identity) !== Boolean(remote) || Boolean(identity) !== Boolean(authority))
    return Promise.reject(new Error('INVALID_PEER_CERTIFICATE'));
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(data));
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), 5000);
    const finish = (error: Error | null, value?: unknown) => {
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    };
    const options = {
      method: 'POST',
      agent: false as const,
      timeout: 5000,
      signal: signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal,
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
    const request = (identity ? secureRequest : httpRequest)(url, options, (response) => {
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
    });
    request.on('timeout', () => request.destroy(new Error('PEER_TIMEOUT')));
    request.on('error', () => finish(new Error('PEER_UNAVAILABLE')));
    request.end(payload);
  });
}

/** Core-owned pairing control. Bootstrap exchanges public certificates only;
 * TLS verifies their chains before either side can confirm the displayed pin.
 * Native RPC is deliberately not exposed by this control listener. */
export class PeerNode {
  private bootstrap: Server | undefined;
  private secure: SecureServer | undefined;
  private sockets = new Set<Socket>();
  private incoming = new Map<string, Incoming>();
  private outgoing = new Map<string, Outgoing>();
  private shared = new Set<string>();
  private active = false;
  private starting = false;
  private securePort = 0;
  private rate: number[] = [];
  private revision = 0;
  private reservations: GpuReservations | undefined;
  private activeRpc:
    | {
        id: string;
        socket: Duplex;
        owned: OwnedPeerRpc;
        reservation: GpuReservation;
        closing?: Promise<void>;
      }
    | undefined;
  private rpcSettling: Promise<void> = Promise.resolve();
  private rpcFailed = false;
  private rpcTimer: ReturnType<typeof setInterval> | undefined;
  private rpcPreparations = new Set<Promise<void>>();
  private readonly lifetime = new AbortController();
  private invitations = 0;
  private outgoingRpc = new Set<Duplex>();
  constructor(
    private readonly identity: WindowsPeerIdentity,
    private readonly name: string,
    private readonly gpus: readonly PeerGpu[],
    private readonly rpcBackend?: PeerRpcBackend,
    private readonly timing = { startup: 20000, stop: 25000 },
  ) {
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
  /** Parent runtime owner only. Release requires its confirmed native exit. */
  reserveLocal(gpuIds: readonly string[]): GpuReservation {
    if (this.lifetime.signal.aborted || this.rpcFailed || !this.reservations)
      throw new Error('NOT_READY');
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
      incoming: [...this.incoming.values()].map((value) => ({
        id: value.id,
        name: value.name,
        peerFingerprint: value.peerFingerprint,
        phase: value.phase,
        localVerified: value.localVerified,
        remoteVerified: value.remoteVerified,
      })),
      outgoing: [...this.outgoing.values()].map((value) => ({
        id: value.id,
        name: value.name,
        peerFingerprint: value.peerFingerprint,
        verified: value.verified,
      })),
    };
  }
  private expire(): void {
    const now = performance.now();
    for (const [id, value] of this.incoming)
      if (value.phase !== 'approved' && value.expires <= now) this.incoming.delete(id);
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
      socket.setTimeout(10000, () => socket.destroy());
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
    try {
      await this.rpcBackend?.openSharing?.(selected);
      if (revision !== this.revision) return invalid('SHARING_STOPPED');
      this.securePort = await listen(this.secure, host, securePort);
      const port = await listen(this.bootstrap, host, bootstrapPort);
      if (revision !== this.revision) return invalid('SHARING_STOPPED');
      this.active = true;
      if (this.reservations)
        this.rpcTimer = setInterval(() => {
          const pending = this.reservations!.pendingRelease();
          if (this.activeRpc && pending.includes(this.activeRpc.reservation))
            void this.stopRpc().catch(() => {
              this.rpcFailed = true;
            });
        }, 1000);
      return `http://${host}:${port}/`;
    } catch {
      await this.stopSharing();
      return invalid('PEER_UNAVAILABLE');
    } finally {
      this.starting = false;
    }
  }
  private async introduce(request: IncomingMessage): Promise<unknown> {
    this.expire();
    if (
      !this.active ||
      request.method !== 'POST' ||
      request.url !== '/v1/pair' ||
      !this.shared.size
    )
      return invalid('NOT_SHARING');
    const now = performance.now();
    this.rate = this.rate.filter((value) => now - value < 60000);
    if (this.rate.length >= 8 || this.incoming.size >= 8) return invalid('PAIRING_LIMIT');
    this.rate.push(now);
    const input = object(await body(request), ['name', 'certificate', 'authority']);
    if (!this.active) return invalid('NOT_SHARING');
    const cert = certificate(input.certificate),
      authority = certificate(input.authority),
      fingerprint = validatePeerCertificate(cert, authority);
    if (fingerprint === this.identity.fingerprint) return invalid('SAME_PEER');
    const value: Incoming = {
      id: randomUUID(),
      name: text(input.name),
      peerFingerprint: fingerprint,
      certificate: cert,
      authority,
      localVerified: false,
      remoteVerified: false,
      phase: 'pending',
      expires: now + 300000,
    };
    this.incoming.set(value.id, value);
    this.refreshTrust();
    return {
      id: value.id,
      name: this.name,
      certificate: this.identity.certificate.toString('base64'),
      authority: this.identity.authority.toString('base64'),
      securePort: this.securePort,
    };
  }
  private async control(request: IncomingMessage): Promise<unknown> {
    this.expire();
    if (!this.active || request.method !== 'POST') return invalid('NOT_SHARING');
    const socket = request.socket as TLSSocket;
    if (!socket.authorized) return invalid('PEER_NOT_AUTHENTICATED');
    const cert = socket.getPeerCertificate();
    if (!cert.raw) return invalid('PEER_NOT_AUTHENTICATED');
    const fingerprint = peerFingerprint(cert.raw);
    const input = object(
      await body(request),
      request.url === '/v1/confirm' ? ['id', 'fingerprint'] : ['id'],
    );
    this.expire();
    const value = this.incoming.get(text(input.id, 36));
    if (!this.active || !value || value.peerFingerprint !== fingerprint)
      return invalid('UNKNOWN_PEER_REQUEST');
    if (value.phase === 'declined') {
      if (request.url === '/v1/status') return { phase: 'declined' };
      return invalid('PEER_DECLINED');
    }
    if (request.url === '/v1/confirm') {
      if (input.fingerprint !== this.identity.fingerprint) return invalid('FINGERPRINT_MISMATCH');
      value.remoteVerified = true;
      if (value.localVerified) value.phase = 'approved';
    } else if (request.url === '/v1/inventory') {
      if (value.phase !== 'approved') return invalid('PEER_NOT_APPROVED');
      return this.gpus.filter((gpu) => this.shared.has(gpu.id));
    } else if (request.url === '/v1/resources') {
      if (value.phase !== 'approved' || !this.rpcBackend?.resources)
        return invalid('RPC_PACKAGE_REQUIRED');
      const revision = this.revision;
      const result = await this.rpcBackend.resources([...this.shared]);
      if (!this.active || revision !== this.revision || value.phase !== 'approved')
        return invalid('SHARING_STOPPED');
      return result;
    } else if (request.url === '/v1/heartbeat') {
      if (
        value.phase !== 'approved' ||
        !this.activeRpc ||
        this.activeRpc.id !== value.id ||
        !this.reservations?.renew(this.activeRpc.reservation)
      )
        return invalid('RPC_LEASE_EXPIRED');
    } else if (request.url !== '/v1/status') return invalid('UNKNOWN_PEER_OPERATION');
    return { phase: value.phase };
  }
  async invite(input: string): Promise<Readonly<{ id: string; peerFingerprint: string }>> {
    if (this.lifetime.signal.aborted) return invalid('PEER_UNAVAILABLE');
    if (this.outgoing.size + this.invitations >= 8) return invalid('PAIRING_LIMIT');
    ++this.invitations;
    try {
      const address = peerAddress(input);
      const response = object(
        await exchange(
          new URL('/v1/pair', address),
          {
            name: this.name,
            certificate: this.identity.certificate.toString('base64'),
            authority: this.identity.authority.toString('base64'),
          },
          undefined,
          undefined,
          this.lifetime.signal,
        ),
        ['id', 'name', 'certificate', 'authority', 'securePort'],
      );
      if (this.lifetime.signal.aborted) return invalid('PEER_UNAVAILABLE');
      const cert = certificate(response.certificate),
        authority = certificate(response.authority),
        fingerprint = validatePeerCertificate(cert, authority);
      const id = text(response.id, 36);
      if (
        !/^[a-f0-9-]{36}$/u.test(id) ||
        fingerprint === this.identity.fingerprint ||
        !Number.isInteger(response.securePort) ||
        (response.securePort as number) < 1024 ||
        (response.securePort as number) > 65535
      )
        return invalid();
      if (this.outgoing.has(id)) return invalid('DUPLICATE_PEER_REQUEST');
      this.outgoing.set(id, {
        id,
        name: text(response.name),
        peerFingerprint: fingerprint,
        certificate: cert,
        authority,
        securePort: response.securePort as number,
        address: address.hostname,
        verified: false,
      });
      return Object.freeze({ id, peerFingerprint: fingerprint });
    } finally {
      --this.invitations;
    }
  }
  approve(id: string, fingerprint: string): Promise<void> {
    return Promise.resolve().then(() => {
      this.expire();
      const value = this.incoming.get(id);
      if (!this.active || !value || value.phase === 'declined')
        return invalid('UNKNOWN_PEER_REQUEST');
      if (fingerprint !== value.peerFingerprint) return invalid('FINGERPRINT_MISMATCH');
      value.localVerified = true;
      if (value.remoteVerified) value.phase = 'approved';
    });
  }
  decline(id: string): void {
    const value = this.incoming.get(id);
    if (!value) return invalid('UNKNOWN_PEER_REQUEST');
    value.phase = 'declined';
    value.localVerified = value.remoteVerified = false;
    if (this.activeRpc?.id === id)
      void this.stopRpc().catch(() => {
        this.rpcFailed = true;
      });
  }
  private async call(id: string, operation: string, data: object = {}): Promise<unknown> {
    const value = this.outgoing.get(id);
    if (!value) return invalid('UNKNOWN_PEER_REQUEST');
    return exchange(
      new URL(`https://${value.address}:${value.securePort}/v1/${operation}`),
      { id, ...data },
      this.identity,
      value.certificate,
      this.lifetime.signal,
      value.authority,
    );
  }
  async confirm(id: string, fingerprint: string): Promise<void> {
    const value = this.outgoing.get(id);
    if (!value) return invalid('UNKNOWN_PEER_REQUEST');
    if (value.peerFingerprint !== fingerprint) return invalid('FINGERPRINT_MISMATCH');
    await this.call(id, 'confirm', { fingerprint });
    value.verified = true;
  }
  async status(id: string): Promise<{ phase: Phase }> {
    const result = object(await this.call(id, 'status'), ['phase']);
    if (!['pending', 'approved', 'declined'].includes(result.phase as string)) return invalid();
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
    await this.rpcSettling;
    if (this.activeRpc || !this.active || peer.phase !== 'approved') {
      socket.destroy();
      return;
    }
    // Only an authenticated, approved request may wait for the native launch
    // budget. Unapproved connections retain the shorter admission deadline.
    tls.setTimeout(this.timing.startup + 1000);
    const transport = [...this.sockets].find(
      (candidate) =>
        candidate.localPort === tls.localPort &&
        candidate.remotePort === tls.remotePort &&
        candidate.remoteAddress === tls.remoteAddress,
    );
    if (!transport) throw new Error('RPC_UNAVAILABLE');
    transport.setTimeout(this.timing.startup + 1000);
    const revision = this.revision;
    const reservation = this.reservations.reserveRemote(peer.peerFingerprint, [...this.shared]);
    let owned: OwnedPeerRpc;
    let starting = true;
    const opening = this.rpcBackend.start(reservation.gpuUuids);
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
      starting = false;
      this.reservations.beginRelease(reservation);
      // A failed backend startup must itself prove teardown before rejecting.
      this.rpcFailed = true;
      throw error;
    }
    if (
      !this.active ||
      revision !== this.revision ||
      socket.destroyed ||
      peer.phase !== 'approved'
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
    this.activeRpc = { id: peer.id, socket, owned, reservation };
    this.reservations.renew(reservation);
    tls.setTimeout(0);
    transport.setTimeout(0);
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: ModelLoom-RPC/1\r\n\r\n',
    );
    if (head.length) socket.unshift(head);
    const stop = () => {
      void this.stopRpc().catch(() => {
        this.rpcFailed = true;
      });
    };
    socket.once('close', stop);
    socket.once('error', stop);
    owned.stream.once('close', stop);
    owned.stream.once('error', stop);
    socket.pipe(owned.stream);
    owned.stream.pipe(socket);
  }
  private stopRpc(): Promise<void> {
    const entry = this.activeRpc;
    if (!entry) return this.rpcSettling;
    if (entry.closing) return entry.closing;
    this.reservations!.beginRelease(entry.reservation);
    entry.socket.destroy();
    entry.closing = peerDeadline(entry.owned.close(), this.timing.stop, 'RPC_CLEANUP_FAILED').then(
      () => {
        this.reservations!.confirmReleased(entry.reservation);
        if (this.activeRpc === entry) this.activeRpc = undefined;
      },
    );
    this.rpcSettling = entry.closing;
    void entry.closing.catch(() => {
      this.rpcFailed = true;
    });
    return entry.closing;
  }
  async openRpc(id: string): Promise<Duplex> {
    const peer = this.outgoing.get(id);
    if (!peer?.verified || (await this.status(id)).phase !== 'approved')
      return invalid('PEER_NOT_APPROVED');
    const socket = await connectPeerRpc(this.identity, peer, this.lifetime.signal);
    if (this.lifetime.signal.aborted) {
      socket.destroy();
      return invalid('PEER_UNAVAILABLE');
    }
    this.outgoingRpc.add(socket);
    const heartbeat = setInterval(() => {
      void this.call(id, 'heartbeat').catch(() => socket.destroy());
    }, 3000);
    socket.once('close', () => {
      clearInterval(heartbeat);
      this.outgoingRpc.delete(socket);
    });
    socket.once('error', () => {
      clearInterval(heartbeat);
      socket.destroy();
    });
    return socket;
  }
  async stopSharing(): Promise<void> {
    this.active = false;
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
        await this.stopRpc();
      } catch (error) {
        workerFailure =
          error instanceof Error ? error : Error('RPC_CLEANUP_FAILED', { cause: error });
      }
    } finally {
      this.incoming.clear();
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
      this.activeRpc = undefined;
      this.rpcSettling = Promise.resolve();
      this.rpcFailed = false;
    }
  }
  async close(): Promise<void> {
    this.lifetime.abort();
    for (const socket of this.outgoingRpc) socket.destroy();
    this.outgoingRpc.clear();
    await this.stopSharing();
    this.outgoing.clear();
  }
}
