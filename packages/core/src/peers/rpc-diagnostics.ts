import { randomUUID } from 'node:crypto';
import { emitRuntimeDiagnostic } from '../hosts/runtime-diagnostics.js';
import type { RuntimeDiagnostic } from '../hosts/runtime-diagnostics.js';

type Phase =
  | 'status'
  | 'overlay'
  | 'tls'
  | 'upgrade'
  | 'gateway-open'
  | 'worker-start'
  | 'lease'
  | 'forwarding';
type Event = 'begin' | 'ready' | 'end' | 'close' | 'error' | 'owner-close';
const codes = new Set([
  'NETWORK_ROUTE_UNAVAILABLE',
  'NETWORK_COMPONENT_FAILED',
  'NETWORK_STREAM_TIMEOUT',
  'INVALID_RPC_CHANNEL',
  'RPC_IPC_TIMEOUT',
  'RPC_RESIDENCY_INVALID',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'ECONNABORTED',
  'ERR_STREAM_DESTROYED',
  'ERR_SSL_TLSV1_ALERT_UNKNOWN_CA',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'CERT_SIGNATURE_FAILURE',
  'ERR_SSL_SSLV3_ALERT_BAD_CERTIFICATE',
  'OVERLAY_DISCONNECTED',
  'OVERLAY_UNAVAILABLE',
  'NETWORK_TIMEOUT',
  'RPC_UNAVAILABLE',
  'RPC_NOT_APPROVED',
  'RPC_RESIDENCY_UNSUPPORTED',
  'RPC_START_TIMEOUT',
  'RPC_DISCONNECTED',
  'RPC_TIMEOUT',
  'RPC_LEASE_EXPIRED',
  'RPC_PACKAGE_REQUIRED',
  'PEER_NOT_APPROVED',
  'PEER_UNAVAILABLE',
  'GPU_BUSY',
  'GPU_NOT_SHARED',
  'SHARING_STOPPED',
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'EPIPE',
  'ERR_STREAM_PREMATURE_CLOSE',
  'ABORT_ERR',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'FINGERPRINT_MISMATCH',
  'INVALID_PEER_CERTIFICATE',
  'RPC_CLEANUP_FAILED',
]);
const safe = (value: unknown) =>
  typeof value === 'string' && codes.has(value) ? value : 'UNKNOWN';
let recent: object[] = [];

/** Lifecycle metadata only. No per-packet work, arbitrary error text or endpoint credentials. */
export function rpcDiagnostics(
  role: 'gateway' | 'client' | 'worker',
  write: RuntimeDiagnostic = emitRuntimeDiagnostic,
  connectionId?: string,
) {
  const id = connectionId && /^[a-f0-9-]{36}$/u.test(connectionId) ? connectionId : randomUUID();
  const started = performance.now();
  return {
    id,
    event(
      phase: Phase,
      event: Event,
      details: {
        error?: unknown;
        side?: 'local' | 'remote' | 'owner';
        uploaded?: number;
        downloaded?: number;
      } = {},
    ) {
      try {
        const error = details.error instanceof Error ? details.error : undefined;
        const cause = error?.cause instanceof Error ? error.cause : undefined;
        const count = (value: unknown) =>
          typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
        const entry = {
          at: new Date().toISOString(),
          connection: id,
          role,
          phase,
          event,
          elapsedMs: Math.round(performance.now() - started),
          ...(details.side ? { side: details.side } : {}),
          ...(error
            ? {
                code: safe(Reflect.get(error, 'code') ?? error.message),
                ...(cause ? { cause: safe(Reflect.get(cause, 'code') ?? cause.message) } : {}),
              }
            : {}),
          ...(details.uploaded !== undefined
            ? { uploaded: count(details.uploaded), downloaded: count(details.downloaded) }
            : {}),
        };
        recent = [...recent.slice(-7), entry];
        write('peer', `rpc.lifecycle ${JSON.stringify(entry)}`);
        if (event === 'error') write('peer', `rpc.failure-context ${JSON.stringify(recent)}`);
      } catch {
        // Diagnostic failures must not affect the byte stream or its cleanup.
      }
    },
  };
}
export type RpcDiagnostic = ReturnType<typeof rpcDiagnostics>;
