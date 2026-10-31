import type { SlotStatus } from './slot-status.js';
import { GENERATION_POLICY } from '../generation/contracts.js';
import { randomUUID } from 'node:crypto';
import { emitRuntimeDiagnostic } from './runtime-diagnostics.js';
import type { RuntimeDiagnostic } from './runtime-diagnostics.js';
class SlotMonitorFault extends Error {
  constructor(readonly reason: string) {
    super('STATUS_UNCONFIRMED');
  }
}
/** Owner-internal captured stream completion, not a caller-supplied outcome. */
export type OwnedStreamEnd = 'terminal' | 'aborted';
type Release = 'released' | 'engine-exited';
interface Reservation {
  readonly slot: number;
  readonly previous: number | null;
  readonly resolve: (release: Release) => void;
  readonly reject: (error: Error) => void;
  task?: number;
  end?: OwnedStreamEnd;
  deadline?: ReturnType<typeof setTimeout>;
}

/**
 * Owner-private, single-engine slot monitor. Initialize once after authenticated
 * owned readiness, then dispatch only already-admitted requests. There is no
 * broker queue or public settlement method. Dispatch returns the captured HTTP
 * stream's completion promise; neither core outcomes nor reader aborts release
 * capacity. A poll begun after stream end must observe the exact slot idle.
 * Cancellation also requires an earlier processing observation of its task.
 * Failed proof retains reservations, rejects release and invokes owned cleanup
 * once. Only the captured exit promise can then confirm resource disposal.
 * The trusted owner may extend observation up to the generation deadline for
 * WAN state transfers, including terminal disposal proof. Cancellation retains
 * its separate five-second bound and never releases capacity without proof.
 */
export class OwnedSlotMonitor {
  private readonly reservations = new Map<number, Reservation>();
  private readonly previous = new Map<number, number | null>();
  private ready = false;
  private initializing = false;
  private closed = false;
  private exitConfirmed = false;
  private cleanupRequested = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private lastPoll = -Infinity;
  private poll: AbortController | undefined;
  private readonly started = performance.now();
  private history: object[] = [];
  private lastSignature = '';
  private recordedAt = -Infinity;

  constructor(
    private readonly count: number,
    private readonly read: (signal: AbortSignal) => Promise<readonly SlotStatus[]>,
    private readonly owns: () => boolean,
    exited: Promise<void>,
    private readonly cleanup: () => void,
    private readonly observationMs = 5000,
    private readonly diagnostic: RuntimeDiagnostic = emitRuntimeDiagnostic,
    private readonly monitorId = randomUUID(),
  ) {
    if (
      !Number.isInteger(count) ||
      count < 1 ||
      count > 1024 ||
      !Number.isSafeInteger(observationMs) ||
      observationMs < 5000 ||
      observationMs > GENERATION_POLICY.generationMs
    )
      throw new Error('STATUS_UNCONFIRMED');
    void exited.then(
      () => this.exited(),
      () => this.fail('EXIT_RECEIPT_REJECTED'),
    );
  }

  /** Initial native state must be idle, with the exact configured slot count. */
  async initialize(): Promise<void> {
    if (this.initializing || this.ready || this.closed) throw new Error('STATUS_UNCONFIRMED');
    this.initializing = true;
    try {
      const status = await this.observe();
      if (this.closed || status.some((slot) => slot.processing))
        throw new SlotMonitorFault('INITIAL_STATE_BUSY');
      for (const slot of status) this.previous.set(slot.id, slot.task);
      this.ready = true;
    } catch (error) {
      this.fail(error instanceof SlotMonitorFault ? error.reason : 'INITIAL_READ_FAILED');
      throw new Error('STATUS_UNCONFIRMED', { cause: error });
    } finally {
      this.initializing = false;
    }
  }

  /** Owner chooses the slot; callers receive only a captured release promise. */
  start(dispatch: (slot: number) => Promise<OwnedStreamEnd>): Promise<Release> {
    if (this.closed) throw new Error('STATUS_UNCONFIRMED');
    if (!this.ready || !this.owns()) {
      this.fail('NOT_READY_OR_OWNER_LOST');
      throw new Error('STATUS_UNCONFIRMED');
    }
    const slot = [...this.previous.keys()].find((id) => !this.reservations.has(id));
    if (slot === undefined) {
      this.fail('CAPACITY_EXHAUSTED');
      throw new Error('NO_NATIVE_CAPACITY');
    }
    let resolve!: Reservation['resolve'], reject!: Reservation['reject'];
    const released = new Promise<Release>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    // A late failure remains handled even when the core has already timed out.
    void released.catch(() => undefined);
    const entry: Reservation = { slot, previous: this.previous.get(slot) ?? null, resolve, reject };
    this.reservations.set(slot, entry);
    this.record('dispatch');
    try {
      const stream = dispatch(slot);
      void stream.then(
        (end) => {
          if (this.closed || this.reservations.get(slot) !== entry) return;
          if (end !== 'terminal' && end !== 'aborted') {
            this.fail('INVALID_STREAM_END');
            return;
          }
          entry.end = end;
          this.record(end);
          entry.deadline = setTimeout(
            () =>
              this.fail(
                end === 'terminal' ? 'TERMINAL_PROOF_TIMEOUT' : 'CANCELLATION_PROOF_TIMEOUT',
              ),
            end === 'terminal' ? this.observationMs : 5000,
          );
        },
        () => this.fail('DISPATCH_REJECTED'),
      );
    } catch {
      // A throw after dispatch cannot prove that no native work was created.
      this.fail('DISPATCH_THROW');
    }
    this.schedule();
    return released;
  }

  private schedule(): void {
    if (this.closed || this.timer || this.poll || !this.reservations.size) return;
    this.timer = setTimeout(
      () => {
        this.timer = undefined;
        void this.check();
      },
      Math.max(0, this.lastPoll + 100 - Date.now()),
    );
  }

  private async observe(): Promise<readonly SlotStatus[]> {
    if (this.closed || !this.owns() || this.poll)
      throw new SlotMonitorFault('OBSERVATION_PRECONDITION');
    const abort = new AbortController();
    this.poll = abort;
    this.lastPoll = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    try {
      const status = await Promise.race([
        this.read(abort.signal),
        new Promise<never>((_, reject) => {
          abort.signal.addEventListener(
            'abort',
            () =>
              reject(
                new SlotMonitorFault(timedOut ? 'OBSERVATION_TIMEOUT' : 'OBSERVATION_ABORTED'),
              ),
            {
              once: true,
            },
          );
          timer = setTimeout(() => {
            timedOut = true;
            abort.abort();
            reject(new SlotMonitorFault('OBSERVATION_TIMEOUT'));
          }, this.observationMs);
        }),
      ]);
      this.record('poll', status);
      if (this.closed || abort.signal.aborted || !this.owns() || status.length !== this.count)
        throw new SlotMonitorFault('OBSERVATION_STATE');
      const ids = new Set<number>(),
        tasks = new Set<number>();
      for (const slot of status) {
        if (
          !Number.isInteger(slot.id) ||
          slot.id < 0 ||
          slot.id >= this.count ||
          ids.has(slot.id) ||
          typeof slot.processing !== 'boolean' ||
          (slot.task !== null &&
            (!Number.isSafeInteger(slot.task) || slot.task < 0 || tasks.has(slot.task))) ||
          (slot.processing && slot.task === null)
        )
          throw new SlotMonitorFault('INVALID_SLOT');
        ids.add(slot.id);
        if (slot.task !== null) tasks.add(slot.task);
      }
      return status;
    } finally {
      if (timer) clearTimeout(timer);
      if (this.poll === abort) this.poll = undefined;
    }
  }

  private async check(): Promise<void> {
    // A response from a check begun before stream end is never a release receipt.
    const captured = new Map(
      [...this.reservations].map(
        ([id, entry]) => [id, { entry, afterEnd: entry.end !== undefined }] as const,
      ),
    );
    try {
      const status = await this.observe();
      const completed: Reservation[] = [];
      for (const slot of status) {
        const snapshot = captured.get(slot.id);
        const current = this.reservations.get(slot.id);
        if (current !== snapshot?.entry) continue; // dispatch occurred during this status request
        if (!snapshot) {
          if (slot.processing || slot.task !== this.previous.get(slot.id))
            throw new SlotMonitorFault('UNRESERVED_SLOT_CHANGED');
          continue;
        }
        const { entry, afterEnd } = snapshot;
        if (entry.task !== undefined && slot.task !== entry.task)
          throw new SlotMonitorFault('TASK_CHANGED');
        if (slot.processing) {
          if (slot.task === null || slot.task === entry.previous)
            throw new SlotMonitorFault('TASK_REUSED');
          entry.task = slot.task;
        } else if (
          afterEnd &&
          slot.task !== null &&
          slot.task !== entry.previous &&
          (entry.end === 'terminal' || entry.task === slot.task)
        ) {
          completed.push(entry);
        }
      }
      // Validate the whole snapshot before releasing any reservation.
      for (const entry of completed) {
        const slot = status.find((item) => item.id === entry.slot)!;
        if (entry.deadline) clearTimeout(entry.deadline);
        this.previous.set(entry.slot, slot.task);
        this.reservations.delete(entry.slot);
        entry.resolve('released');
      }
    } catch (error) {
      this.fail(error instanceof SlotMonitorFault ? error.reason : 'READ_FAILED');
    } finally {
      this.schedule();
    }
  }

  private stopTimers(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.poll?.abort();
    for (const entry of this.reservations.values())
      if (entry.deadline) clearTimeout(entry.deadline);
  }

  /** Retain only scalar slot metadata, on changes or every five seconds, never native text. */
  private record(event: string, status?: readonly SlotStatus[]): void {
    try {
      const integer = (value: unknown) =>
        typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
      const slots = status
        ?.slice(0, 8)
        .map((slot) => [
          integer(slot.id),
          typeof slot.processing === 'boolean' ? slot.processing : null,
          integer(slot.task),
        ]);
      const active = [...this.reservations.values()]
        .slice(0, 8)
        .map((entry) => [entry.slot, entry.previous, entry.task ?? null, entry.end ?? null]);
      const signature = JSON.stringify({ slots, active });
      const now = performance.now();
      if (event === 'poll' && signature === this.lastSignature && now - this.recordedAt < 5000)
        return;
      this.lastSignature = signature;
      this.recordedAt = now;
      this.history = [
        ...this.history.slice(-7),
        {
          elapsedMs: Math.round(now - this.started),
          event,
          ...(status ? { count: status.length, slots } : {}),
          active,
        },
      ];
    } catch {
      /* Diagnostics must not affect ownership or slot validation. */
    }
  }

  private fail(reason: string): void {
    if (this.exitConfirmed) return;
    if (!this.cleanupRequested) {
      try {
        const context = [...this.history];
        const message = () =>
          `slots.monitor-failed ${JSON.stringify({ monitor: this.monitorId, reason, deadlineMs: this.observationMs, closed: this.closed, history: context })}`;
        while (message().length > 4096 && context.length) context.shift();
        this.diagnostic('runtime', message());
      } catch {
        /* Logs cannot prevent the existing failure cleanup. */
      }
    }
    this.closed = true;
    this.stopTimers();
    for (const entry of this.reservations.values()) entry.reject(new Error('STATUS_UNCONFIRMED'));
    if (!this.cleanupRequested) {
      this.cleanupRequested = true;
      try {
        this.cleanup();
      } catch {
        // Failed disposal is already reported by rejected release promises.
        // Retain every reservation; only captured exit can confirm disposal.
        return;
      }
    }
  }

  private exited(): void {
    this.exitConfirmed = true;
    this.closed = true;
    this.stopTimers();
    for (const entry of this.reservations.values()) entry.resolve('engine-exited');
    this.reservations.clear();
  }
}
