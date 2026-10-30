import { randomUUID } from 'node:crypto';
import { open, rename, unlink } from 'node:fs/promises';
import path from 'node:path';

export interface PeerFailure {
  stage: 'inventory' | 'heartbeat' | 'rpc-close';
  decision: 'retry' | 'disconnect' | 'close';
  error: unknown;
}
const codes = new Set([
  'OVERLAY_DISCONNECTED',
  'OVERLAY_UNAVAILABLE',
  'NETWORK_TIMEOUT',
  'PEER_UNAVAILABLE',
  'PEER_DISCONNECTED',
  'PEER_NOT_APPROVED',
  'GPU_NOT_SHARED',
  'RPC_LEASE_EXPIRED',
  'NOT_SHARING',
  'SHARING_STOPPED',
  'INVALID_PEER_MESSAGE',
  'INVALID_PEER_CERTIFICATE',
  'FINGERPRINT_MISMATCH',
  'RPC_STREAM_CLOSED',
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'EPIPE',
  'ERR_STREAM_PREMATURE_CLOSE',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'ABORT_ERR',
]);
const safeCode = (value: unknown) =>
  typeof value === 'string' && codes.has(value) ? value : 'UNKNOWN';

/** Fixed-size local diagnostics. Never retains prompts, addresses, keys or arbitrary error text. */
export class PeerFailureJournal {
  private events: object[] = [];
  private pending: Promise<void> | undefined;
  constructor(private readonly directory: string) {}
  record(event: PeerFailure): void {
    const error = event.error instanceof Error ? event.error : undefined;
    const cause = error?.cause instanceof Error ? error.cause : undefined;
    this.events = [
      ...this.events.slice(-63),
      {
        at: new Date().toISOString(),
        stage: event.stage,
        decision: event.decision,
        code: safeCode(error?.message),
        ...(cause
          ? { cause: safeCode(Reflect.get(cause, 'code')), transport: safeCode(cause.message) }
          : {}),
      },
    ];
    try {
      console.error(`[ModelLoom][peer] ${JSON.stringify(this.events.at(-1))}`);
    } catch {
      /* Keep cleanup independent of diagnostic output. */
    }
    this.pending ??= Promise.resolve().then(() => this.write());
  }
  private async write(): Promise<void> {
    while (true) {
      const snapshot = this.events;
      const temporary = path.join(this.directory, `connection-failures-${randomUUID()}.tmp`);
      try {
        const file = await open(temporary, 'wx');
        try {
          await file.writeFile(JSON.stringify(snapshot));
        } finally {
          await file.close();
        }
        await rename(temporary, path.join(this.directory, 'connection-failures.json'));
      } catch {
        // Diagnostic I/O must not prevent worker cleanup or turn a retry into a session failure.
      } finally {
        await unlink(temporary).catch(() => undefined);
      }
      if (snapshot === this.events) {
        this.pending = undefined;
        return;
      }
    }
  }
  flush(): Promise<void> {
    return this.pending ?? Promise.resolve();
  }
}
