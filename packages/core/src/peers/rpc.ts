import { createServer } from 'node:net';
import type { Server, Socket } from 'node:net';
import { request } from 'node:https';
import { X509Certificate } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import type { Duplex } from 'node:stream';
import { connect as tlsConnect } from 'node:tls';
import { overlaySocket } from './overlay-socket.js';
import type { PeerOverlayTransport } from './overlay.js';
import type { WindowsPeerIdentity } from './windows-identity.js';
import { peerFingerprint, validatePeerCertificate } from './windows-identity.js';
import { peerDeadline, RPC_OPEN_MS } from './deadline.js';
import type { PeerResources } from './resources.js';
import { rpcDiagnostics } from './rpc-diagnostics.js';
import type { RpcDiagnostic } from './rpc-diagnostics.js';
import {
  rpcResidencyStream,
  RPC_RESIDENCY_HEADER,
  RPC_RESIDENCY_VERSION,
} from './rpc-residency.js';

// The worker has a 20-second verified launch budget, including UAC approval.
// Its callers must allow that budget to finish before abandoning the connection.
const rpcUpgradeTimeout = 25_000;
const gatewayOpenTimeout = RPC_OPEN_MS + 1000;

export interface OwnedPeerRpc {
  readonly stream: Duplex;
  readonly cacheError?: 'CACHE_LOCATION_UNAVAILABLE';
  close(): Promise<void>;
}
export interface PeerRpcBackend {
  /** Supports the app-owned data codec; this grants no native launch authority. */
  readonly inputResidency?: boolean;
  /** Local sharing admission only. Remote start must never acquire elevation. */
  openSharing?(gpuIds: readonly string[]): Promise<void>;
  /** Trusted local network admission after listeners bind, before sharing becomes
   * available. Loss closes admission; callers cannot supply programs or ports. */
  openNetwork?(address: string, lost: () => void): Promise<void>;
  /** Called after admission closes; confirm worker/helper cleanup before release. */
  closeSharing?(): Promise<void>;
  start(
    gpuIds: readonly string[],
    cacheRequested?: boolean,
    cacheOwner?: string,
  ): Promise<OwnedPeerRpc>;
  /** Local preferences only; false also bypasses caches on remote workers. */
  cacheEnabled?(): Promise<boolean>;
  resources?(gpuIds: readonly string[]): Promise<PeerResources>;
}
export interface PeerRpcTarget {
  readonly id: string;
  readonly address: string;
  readonly securePort: number;
  readonly certificate: Buffer;
  readonly authority: Buffer;
}

/** mTLS and exact approved-key verification precede exposing the opaque stream. */
export async function connectPeerRpc(
  identity: WindowsPeerIdentity,
  target: PeerRpcTarget,
  signal?: AbortSignal,
  gpuId?: string,
  overlay?: PeerOverlayTransport,
  cacheEnabled = false,
  trace: RpcDiagnostic = rpcDiagnostics('client'),
): Promise<Duplex> {
  if (gpuId !== undefined && !/^GPU-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(gpuId))
    return Promise.reject(new Error('INVALID_GPU_RESERVATION'));
  validatePeerCertificate(target.certificate, target.authority);
  let raw: ReturnType<typeof overlaySocket> | undefined;
  if (overlay?.has(target.address)) {
    trace.event('overlay', 'begin');
    try {
      raw = overlaySocket(await overlay.dial(target.address, target.securePort, signal));
      trace.event('overlay', 'ready');
    } catch (error) {
      trace.event('overlay', 'error', { error });
      throw error;
    }
  }
  return new Promise((resolve, reject) => {
    let phase: 'tls' | 'upgrade' = 'tls';
    trace.event(phase, 'begin');
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), rpcUpgradeTimeout);
    const failed = (error: Error) => {
      clearTimeout(timer);
      trace.event(phase, 'error', { error });
      reject(error);
    };
    const options = {
      host: target.address,
      port: target.securePort,
      signal: signal ? AbortSignal.any([signal, abort.signal]) : abort.signal,
      path: `/v1/rpc/${target.id}`,
      method: 'POST',
      agent: false,
      timeout: rpcUpgradeTimeout,
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'ModelLoom-RPC/1',
        ...(gpuId !== undefined ? { 'X-ModelLoom-GPU': gpuId } : {}),
        'X-ModelLoom-Tensor-Cache': cacheEnabled ? '1' : '0',
        [RPC_RESIDENCY_HEADER]: RPC_RESIDENCY_VERSION,
        'X-ModelLoom-RPC-Trace': trace.id,
      },
      pfx: identity.pfx,
      ca: new X509Certificate(target.authority).toString(),
      rejectUnauthorized: true,
      minVersion: 'TLSv1.3' as const,
      maxVersion: 'TLSv1.3' as const,
      checkServerIdentity: (_host: string, cert: { raw: Buffer }) =>
        peerFingerprint(cert.raw) === peerFingerprint(target.certificate)
          ? undefined
          : new Error('FINGERPRINT_MISMATCH'),
    };
    const req = request({
      ...options,
      ...(raw
        ? { agent: undefined, createConnection: () => tlsConnect({ ...options, socket: raw }) }
        : {}),
    });
    req.once('socket', (socket) => {
      socket.once('secureConnect', () => {
        trace.event('tls', 'ready');
        phase = 'upgrade';
        trace.event('upgrade', 'begin');
      });
    });
    req.once('upgrade', (response, socket, head) => {
      clearTimeout(timer);
      if (response.statusCode !== 101 || response.headers.upgrade !== 'ModelLoom-RPC/1') {
        socket.destroy();
        failed(new Error('RPC_NOT_APPROVED'));
        return;
      }
      if (head.length) socket.unshift(head);
      socket.setTimeout(0);
      const residency = response.headers[RPC_RESIDENCY_HEADER];
      if (residency !== undefined && residency !== RPC_RESIDENCY_VERSION) {
        socket.destroy();
        failed(new Error('RPC_RESIDENCY_UNSUPPORTED'));
        return;
      }
      trace.event('upgrade', 'ready');
      socket.once('end', () => trace.event('forwarding', 'end', { side: 'remote' }));
      socket.once('error', (error) =>
        trace.event('forwarding', 'error', { side: 'remote', error }),
      );
      socket.once('close', () =>
        trace.event('forwarding', 'close', {
          uploaded: socket.bytesWritten,
          downloaded: socket.bytesRead,
        }),
      );
      resolve(residency === RPC_RESIDENCY_VERSION ? rpcResidencyStream(socket, 'client') : socket);
    });
    req.once('response', (response) => {
      response.resume();
      failed(new Error('RPC_NOT_APPROVED'));
    });
    req.once('timeout', () => req.destroy(new Error('RPC_TIMEOUT')));
    req.once('error', (error) => failed(new Error('RPC_UNAVAILABLE', { cause: error })));
    req.end();
  });
}

/** A byte relay, not a native RPC parser. Kernel tuple ownership is checked
 * before forwarding a byte. Only the runtime owner's retained process may enter. */
export async function localRpcGateway(
  allowed: (pid: number) => boolean,
  connect: () => Promise<Duplex>,
  lost?: () => void,
): Promise<{
  readonly port: number;
  progress(): Readonly<{ uploaded: number; downloaded: number }>;
  close(): Promise<void>;
}> {
  const binding: unknown = createRequire(import.meta.url)(
    fileURLToPath(new URL('../../out/native/peer-identity.node', import.meta.url)),
  );
  if (
    !binding ||
    typeof binding !== 'object' ||
    typeof Reflect.get(binding, 'loopbackClientPid') !== 'function'
  )
    throw new Error('INVALID_NATIVE_BINDING');
  const native = binding as { loopbackClientPid(local: number, remote: number): number };
  const sockets = new Set<Duplex>();
  let closed = false;
  let lossReported = false;
  const reportLoss = () => {
    if (closed || lossReported) return;
    lossReported = true;
    lost?.();
  };
  let uploaded = 0,
    downloaded = 0;
  const server: Server = createServer({ pauseOnConnect: true }, (socket: Socket) => {
    void (async () => {
      let admitted = false;
      const trace = rpcDiagnostics('gateway');
      let firstSide: 'local' | 'remote' | 'owner' | undefined;
      let sent = 0,
        received = 0;
      const closing = (
        side: 'local' | 'remote' | 'owner',
        event: 'end' | 'close' | 'error',
        error?: unknown,
      ) => {
        firstSide ??= closed ? 'owner' : side;
        trace.event('forwarding', event, {
          side: firstSide,
          ...(error ? { error } : {}),
          uploaded: sent,
          downloaded: received,
        });
      };
      try {
        const local = socket.address();
        if (
          closed ||
          sockets.size >= 8 ||
          typeof local === 'string' ||
          !('port' in local) ||
          !socket.remotePort ||
          !allowed(native.loopbackClientPid(local.port, socket.remotePort))
        ) {
          socket.destroy();
          return;
        }
        sockets.add(socket);
        admitted = true;
        trace.event('gateway-open', 'begin');
        let localEnded = false;
        socket.once('end', () => {
          localEnded = true;
          closing('local', 'end');
        });
        socket.once('close', () => {
          closing('local', 'close');
          sockets.delete(socket);
        });
        socket.on('error', (error) => {
          closing('local', 'error', error);
          socket.destroy();
        });
        const opening = connect();
        // A late connection after shutdown is never admitted or left live.
        void opening.then(
          (remote) => {
            if (closed || socket.destroyed) remote.destroy();
          },
          () => undefined,
        );
        const remote = await peerDeadline(opening, gatewayOpenTimeout, 'RPC_START_TIMEOUT');
        if (remote.destroyed) throw Error('RPC_DISCONNECTED');
        if (closed || socket.destroyed) {
          remote.destroy();
          return;
        }
        sockets.add(remote);
        trace.event('gateway-open', 'ready');
        socket.once('error', () => remote.destroy());
        const remoteLost = () => {
          if (!localEnded && !socket.destroyed) {
            if (!lossReported)
              trace.event('forwarding', 'error', {
                side: 'remote',
                error: Error('RPC_DISCONNECTED'),
                uploaded: sent,
                downloaded: received,
              });
            reportLoss();
          }
        };
        remote.once('end', () => {
          closing('remote', 'end');
          remoteLost();
        });
        remote.once('error', (error) => {
          closing('remote', 'error', error);
          remoteLost();
          socket.destroy();
        });
        socket.once('close', () => {
          sockets.delete(socket);
          remote.destroy();
        });
        remote.once('close', () => {
          closing('remote', 'close');
          sockets.delete(remote);
          // Stock also opens short-lived enumeration connections. Their local
          // owner may close normally without invalidating the loaded instance.
          remoteLost();
          socket.destroy();
        });
        socket.on('data', (bytes: Buffer) => {
          uploaded += bytes.length;
          sent += bytes.length;
        });
        remote.on('data', (bytes: Buffer) => {
          downloaded += bytes.length;
          received += bytes.length;
        });
        socket.pipe(remote);
        remote.pipe(socket);
        socket.resume();
      } catch (error) {
        if (admitted) trace.event('gateway-open', 'error', { error });
        if (admitted) reportLoss();
        socket.destroy();
      }
    })();
  });
  server.maxConnections = 4;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('RPC_UNAVAILABLE');
  return {
    port: address.port,
    progress: () => ({ uploaded, downloaded }),
    async close() {
      closed = true;
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
