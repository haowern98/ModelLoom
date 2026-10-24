import { request as httpsRequest } from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { X509Certificate } from 'node:crypto';
import { once } from 'node:events';
import { peerFingerprint, validatePeerCertificate } from './windows-identity.js';
import type { WindowsPeerIdentity } from './windows-identity.js';
import type { PeerRpcTarget } from './rpc.js';

export const DIAGNOSTIC_BYTES = 16 * 1024 * 1024;
export const DIAGNOSTIC_MS = 1500;
const chunk = Buffer.alloc(4 * 1024);
export type DiagnosticDirection = 'upload' | 'download';

/** One fixed-size, bounded probe. Caller supplies approved identity and idle admission. */
export async function serveDiagnostic(
  request: IncomingMessage,
  response: ServerResponse,
  direction: DiagnosticDirection,
  inputSignal: AbortSignal,
): Promise<void> {
  const closed = new AbortController();
  const signal = AbortSignal.any([inputSignal, closed.signal]);
  const onClose = () => closed.abort();
  response.once('close', onClose);
  const abort = () => {
    request.destroy();
    response.destroy();
  };
  signal.addEventListener('abort', abort, { once: true });
  try {
    signal.throwIfAborted();
    if (direction === 'download') {
      if (request.headers['content-length'] !== '0') throw Error('INVALID_PEER_MESSAGE');
      response.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': DIAGNOSTIC_BYTES,
        'Cache-Control': 'no-store',
        Connection: 'close',
      });
      for (let sent = 0; sent < DIAGNOSTIC_BYTES; sent += chunk.length) {
        signal.throwIfAborted();
        if (!response.write(chunk)) await once(response, 'drain', { signal });
      }
      response.end();
      await once(response, 'finish', { signal });
    } else {
      const start = performance.now();
      let bytes = 0;
      for await (const part of request) {
        signal.throwIfAborted();
        bytes += (part as Buffer).length;
        if (bytes > DIAGNOSTIC_BYTES) throw Error('PEER_MESSAGE_TOO_LARGE');
      }
      if (!bytes) throw Error('INVALID_PEER_MESSAGE');
      const mbps = (bytes * 8) / Math.max(performance.now() - start, 0.001) / 1000;
      response.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        Connection: 'close',
      });
      response.end(JSON.stringify({ mbps }));
      await once(response, 'finish', { signal });
    }
  } finally {
    response.off('close', onClose);
    signal.removeEventListener('abort', abort);
  }
}

/** Measures payload throughput over the pinned TLS path; never opens an RPC helper. */
export async function measureDiagnostic(
  identity: WindowsPeerIdentity,
  target: PeerRpcTarget,
  direction: DiagnosticDirection,
  signal: AbortSignal,
): Promise<number> {
  validatePeerCertificate(target.certificate, target.authority);
  const combined = AbortSignal.any([signal, AbortSignal.timeout(DIAGNOSTIC_MS)]);
  return new Promise<number>((resolve, reject) => {
    const request = httpsRequest(
      {
        host: target.address,
        port: target.securePort,
        path: `/v1/diagnostics/${target.id}/${direction}`,
        method: 'POST',
        agent: false,
        signal: combined,
        headers:
          direction === 'download'
            ? { 'Content-Length': 0 }
            : { 'Content-Type': 'application/octet-stream' },
        pfx: identity.pfx,
        ca: new X509Certificate(target.authority).toString(),
        minVersion: 'TLSv1.3',
        maxVersion: 'TLSv1.3',
        rejectUnauthorized: true,
        checkServerIdentity: (_host, cert) =>
          peerFingerprint(cert.raw) === peerFingerprint(target.certificate)
            ? undefined
            : Error('FINGERPRINT_MISMATCH'),
      },
      (response) => {
        void (async () => {
          if (response.statusCode !== 200) {
            response.destroy();
            throw Error(
              response.statusCode === 503 ? 'DIAGNOSTICS_BUSY' : 'DIAGNOSTICS_UNSUPPORTED',
            );
          }
          const start = performance.now();
          let bytes = 0;
          const parts: Buffer[] = [];
          // Slow links still produce a partial sample; no minimum link speed is assumed.
          const sample =
            direction === 'download'
              ? setTimeout(() => {
                  if (!combined.aborted && bytes > 0)
                    resolve((bytes * 8) / Math.max(performance.now() - start, 0.001) / 1000);
                  else reject(Error('DIAGNOSTICS_UNAVAILABLE'));
                  response.destroy();
                  request.destroy();
                }, 500)
              : undefined;
          try {
            for await (const part of response) {
              const value = part as Buffer;
              bytes += value.length;
              if (bytes > (direction === 'download' ? DIAGNOSTIC_BYTES : 128))
                throw Error('INVALID_PEER_MESSAGE');
              if (direction === 'upload') parts.push(value);
            }
          } finally {
            clearTimeout(sample);
          }
          if (combined.aborted) throw Error('DIAGNOSTICS_CANCELLED');
          if (direction === 'download') {
            if (bytes <= 0 || bytes > DIAGNOSTIC_BYTES) throw Error('INVALID_PEER_MESSAGE');
            return (bytes * 8) / Math.max(performance.now() - start, 0.001) / 1000;
          }
          const result: unknown = JSON.parse(Buffer.concat(parts).toString('utf8'));
          const value: unknown =
            result && typeof result === 'object' ? Reflect.get(result, 'mbps') : null;
          if (
            typeof value !== 'number' ||
            !Number.isFinite(value) ||
            value <= 0 ||
            value > Number.MAX_SAFE_INTEGER
          )
            throw Error('INVALID_PEER_MESSAGE');
          return value;
        })().then(resolve, (error: unknown) => {
          request.destroy();
          reject(error instanceof Error ? error : Error('DIAGNOSTICS_UNAVAILABLE'));
        });
      },
    );
    request.on('error', reject);
    if (direction === 'download') request.end();
    else {
      // Stop producing at 500ms even on a slow path; backpressure bounds queued bytes.
      const stop = setTimeout(() => request.end(), 500);
      const clear = () => clearTimeout(stop);
      request.once('close', clear);
      void (async () => {
        try {
          let bytes = 0;
          const start = performance.now();
          while (
            bytes < DIAGNOSTIC_BYTES &&
            performance.now() - start < 500 &&
            !request.writableEnded
          ) {
            combined.throwIfAborted();
            if (!request.write(chunk)) await once(request, 'drain', { signal: combined });
            bytes += chunk.length;
          }
          if (!request.writableEnded) request.end();
        } catch (error) {
          request.destroy();
          reject(error instanceof Error ? error : Error('DIAGNOSTICS_UNAVAILABLE'));
        } finally {
          clear();
        }
      })();
    }
  });
}

/** A single probe at a time and one burst per direction/peer/minute, bounded to eight peers. */
export class DiagnosticAdmission {
  private current: AbortController | undefined;
  private attempts = new Map<string, number>();
  acquire(key: string, now = performance.now()): { signal: AbortSignal; release(): void } {
    for (const [id, at] of this.attempts) if (now - at >= 60000) this.attempts.delete(id);
    if (this.current || this.attempts.has(key) || this.attempts.size >= 16)
      throw Error('DIAGNOSTICS_BUSY');
    this.attempts.set(key, now);
    const controller = new AbortController();
    this.current = controller;
    return {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(DIAGNOSTIC_MS)]),
      release: () => {
        if (this.current === controller) this.current = undefined;
      },
    };
  }
  cancel(): void {
    this.current?.abort();
    this.current = undefined;
  }
}
