import type { SlotStatus } from './slot-status.js';
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

  constructor(
    private readonly count: number,
    private readonly read: (signal: AbortSignal) => Promise<readonly SlotStatus[]>,
    private readonly owns: () => boolean,
    exited: Promise<void>,
    private readonly cleanup: () => void,
  ) {
    if (!Number.isInteger(count) || count < 1 || count > 4) throw new Error('STATUS_UNCONFIRMED');
    void exited.then(
      () => this.exited(),
      () => this.fail(),
    );
  }

  /** Initial native state must be idle, with the exact configured slot count. */
  async initialize(): Promise<void> {
    if (this.initializing || this.ready || this.closed) throw new Error('STATUS_UNCONFIRMED');
    this.initializing = true;
    try {
      const status = await this.observe();
      if (this.closed || status.some((slot) => slot.processing))
        throw new Error('STATUS_UNCONFIRMED');
      for (const slot of status) this.previous.set(slot.id, slot.task);
      this.ready = true;
    } catch {
      this.fail();
      throw new Error('STATUS_UNCONFIRMED');
    } finally {
      this.initializing = false;
    }
  }

  /** Owner chooses the slot; callers receive only a captured release promise. */
  start(dispatch: (slot: number) => Promise<OwnedStreamEnd>): Promise<Release> {
    if (this.closed) throw new Error('STATUS_UNCONFIRMED');
    if (!this.ready || !this.owns()) {
      this.fail();
      throw new Error('STATUS_UNCONFIRMED');
    }
    const slot = [...this.previous.keys()].find((id) => !this.reservations.has(id));
    if (slot === undefined) {
      this.fail();
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
    try {
      const stream = dispatch(slot);
      void stream.then(
        (end) => {
          if (this.closed || this.reservations.get(slot) !== entry) return;
          if (end !== 'terminal' && end !== 'aborted') {
            this.fail();
            return;
          }
          entry.end = end;
          entry.deadline = setTimeout(() => this.fail(), 5000);
        },
        () => this.fail(),
      );
    } catch {
      // A throw after dispatch cannot prove that no native work was created.
      this.fail();
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
    if (this.closed || !this.owns() || this.poll) throw new Error('STATUS_UNCONFIRMED');
    const abort = new AbortController();
    this.poll = abort;
    this.lastPoll = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const status = await Promise.race([
        this.read(abort.signal),
        new Promise<never>((_, reject) => {
          abort.signal.addEventListener('abort', () => reject(new Error('STATUS_UNCONFIRMED')), {
            once: true,
          });
          timer = setTimeout(() => {
            abort.abort();
            reject(new Error('STATUS_UNCONFIRMED'));
          }, 5000);
        }),
      ]);
      if (this.closed || abort.signal.aborted || !this.owns() || status.length !== this.count)
        throw new Error('STATUS_UNCONFIRMED');
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
          throw new Error('STATUS_UNCONFIRMED');
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
            throw new Error('STATUS_UNCONFIRMED');
          continue;
        }
        const { entry, afterEnd } = snapshot;
        if (entry.task !== undefined && slot.task !== entry.task)
          throw new Error('STATUS_UNCONFIRMED');
        if (slot.processing) {
          if (slot.task === null || slot.task === entry.previous)
            throw new Error('STATUS_UNCONFIRMED');
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
    } catch {
      this.fail();
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

  private fail(): void {
    if (this.exitConfirmed) return;
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
