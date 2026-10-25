import { emptyTelemetry, type PeerTelemetry } from './telemetry-view.js';

interface MonitorOptions {
  ping(signal: AbortSignal): Promise<number>;
  bandwidth(
    signal: AbortSignal,
  ): Promise<{ uploadMbps: number | null; downloadMbps: number | null }>;
  totals(): { sent: number; received: number };
  active(): boolean;
  changed(): void;
  now?: () => number;
  wallNow?: () => number;
  bandwidthCooldownMs?: number;
}

const cancelled = Symbol('cancelled');

/** Cancel observation even when an adapter does not promptly settle its promise. */
async function observe<T>(
  signal: AbortSignal,
  operation: () => Promise<T>,
): Promise<T | typeof cancelled> {
  if (signal.aborted) return cancelled;
  let onAbort!: () => void;
  const aborted = new Promise<typeof cancelled>((resolve) => {
    onAbort = () => resolve(cancelled);
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([operation(), aborted]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

/** Serial, optional diagnostics. The owner supplies authenticated operations and deadlines.
 * Activity cancels bulk tests synchronously; cumulative counters remain passive. */
export class PeerTelemetryMonitor {
  private snapshot = emptyTelemetry();
  private closed = false;
  private running = false;
  private explicitlyActive = false;
  private controller: AbortController | undefined;
  private previous: { at: number; sent: number; received: number } | undefined;
  private lastAttempt = -Infinity;
  private unsupported = false;
  private pingFailed = false;
  private idleState: PeerTelemetry['state'] = 'idle';
  private readonly now: () => number;
  private readonly wallNow: () => number;

  constructor(private readonly options: MonitorOptions) {
    this.now = options.now ?? (() => performance.now());
    this.wallNow = options.wallNow ?? Date.now;
  }

  view(): PeerTelemetry {
    return { ...this.snapshot };
  }

  private busy(): boolean {
    return this.explicitlyActive || this.options.active();
  }

  private update(patch: Partial<PeerTelemetry>): void {
    if (this.closed) return;
    const next = { ...this.snapshot, ...patch };
    if (
      (Object.keys(next) as (keyof PeerTelemetry)[]).every(
        (key) => next[key] === this.snapshot[key],
      )
    )
      return;
    this.snapshot = next;
    this.options.changed();
  }

  setActive(active: boolean): void {
    if (this.closed) return;
    this.explicitlyActive = active;
    if (this.busy()) {
      this.controller?.abort();
      this.update({ state: 'active' });
    } else {
      this.update({ state: this.idleState });
    }
  }

  async tick(): Promise<void> {
    if (this.closed || this.running) return;
    this.running = true;
    const controller = new AbortController();
    this.controller = controller;
    try {
      const at = this.now();
      const totals = this.options.totals();
      const elapsed = this.previous ? (at - this.previous.at) / 1000 : 0;
      const rate = (value: number, old: number) =>
        elapsed > 0 ? Math.max(0, value - old) / elapsed : 0;
      this.update({
        sendingBytesPerSecond: rate(totals.sent, this.previous?.sent ?? totals.sent),
        receivingBytesPerSecond: rate(totals.received, this.previous?.received ?? totals.received),
        state: this.busy() ? 'active' : this.idleState,
      });
      this.previous = { at, ...totals };
      try {
        const latency = await observe(controller.signal, () =>
          this.options.ping(controller.signal),
        );
        if (this.closed || controller.signal.aborted || latency === cancelled) return;
        if (!Number.isFinite(latency) || latency < 0) throw Error('INVALID_DIAGNOSTICS');
        if (this.pingFailed) {
          this.pingFailed = false;
          this.idleState = this.unsupported ? 'unsupported' : 'idle';
        }
        this.update({
          latencyMs: latency,
          latencyMeasuredAt: this.wallNow(),
          state: this.busy() ? 'active' : this.idleState,
        });
      } catch {
        if (this.closed || controller.signal.aborted) return;
        // A failed latency sample must not erase the last measured value.
        this.pingFailed = true;
        this.idleState = 'unavailable';
        this.update({ state: this.busy() ? 'active' : 'unavailable' });
        return;
      }
      if (this.busy()) {
        this.update({ state: 'active' });
        return;
      }
      if (
        this.unsupported ||
        this.now() - this.lastAttempt < (this.options.bandwidthCooldownMs ?? 60000)
      )
        return;
      this.lastAttempt = this.now();
      this.update({ state: 'testing' });
      try {
        const result = await observe(controller.signal, () =>
          this.options.bandwidth(controller.signal),
        );
        if (this.closed || controller.signal.aborted || result === cancelled) return;
        if (this.busy()) {
          this.update({ state: 'active' });
          return;
        }
        if (
          [result.uploadMbps, result.downloadMbps].every((value) => value === null) ||
          ![result.uploadMbps, result.downloadMbps].every(
            (value) => value === null || (Number.isFinite(value) && value >= 0),
          )
        )
          throw Error('INVALID_DIAGNOSTICS');
        this.idleState = 'idle';
        this.update({ ...result, state: 'idle', bandwidthMeasuredAt: this.wallNow() });
      } catch (error) {
        if (this.closed || controller.signal.aborted) return;
        const message = error instanceof Error ? error.message : String(error);
        this.unsupported =
          message === 'UNKNOWN_PEER_OPERATION' || message === 'DIAGNOSTICS_UNSUPPORTED';
        // Busy is a scheduling result, not a failed control connection.
        this.idleState =
          message === 'DIAGNOSTICS_BUSY'
            ? 'idle'
            : this.unsupported
              ? 'unsupported'
              : 'unavailable';
        this.update({ state: this.busy() ? 'active' : this.idleState });
      }
    } finally {
      if (this.controller === controller) this.controller = undefined;
      this.running = false;
    }
  }

  close(): void {
    this.closed = true;
    this.controller?.abort();
  }
}
