import type { Identity } from '../runtime/contracts.js';
import { decodeOutcome, decodeRequestIdentity, GENERATION_POLICY } from './contracts.js';
import type {
  GenerationPolicy,
  InterruptionReason,
  RequestIdentity,
  TerminalOutcome,
} from './contracts.js';

/** Settlement fulfills only after this request no longer owns native work/slot capacity.
 * Rejection is unconfirmed cleanup. A fulfilled cancel call alone is not settlement.
 */
export interface GenerationExecution {
  readonly settled: Promise<TerminalOutcome>;
  cancel(): void | Promise<void>;
}
export interface GenerationExecutor {
  /** A synchronous throw guarantees no work was created; otherwise return its captured capability. */
  start(identity: RequestIdentity): GenerationExecution;
}
export interface RequestView {
  readonly identity: RequestIdentity;
  readonly state: 'queued' | 'running' | 'cancelling';
  readonly outcome?: TerminalOutcome;
}
export type AdmissionResult =
  | {
      readonly accepted: true;
      readonly identity: RequestIdentity;
      readonly state: RequestView['state'];
      readonly done: Promise<TerminalOutcome>;
    }
  | {
      readonly accepted: false;
      readonly code: 'INVALID_CONTROL' | 'NOT_READY' | 'QUEUE_FULL' | 'CONVERSATION_BUSY';
    };
export type CancelResult = 'requested' | 'already-terminal' | 'denied';

interface Entry {
  readonly identity: RequestIdentity;
  state: RequestView['state'];
  readonly resolve: (outcome: TerminalOutcome) => void;
  execution?: GenerationExecution;
  timer?: ReturnType<typeof setTimeout>;
  cancellationTimer?: ReturnType<typeof setTimeout>;
  cancelOutcome?: TerminalOutcome;
  outcome?: TerminalOutcome;
  cancelSent: boolean;
}

/** One session's finite core queue. Only captured executor settlement releases active capacity.
 * Completed records belong in HistoryStore, not an unbounded in-memory terminal list.
 * The service must persist/reject replayed attempts before submitting fresh core-generated IDs.
 */
export class GenerationAdmission {
  private readonly session: Identity;
  private readonly entries = new Map<string, Entry>();
  private closed = false;
  private unsafe = false;
  private readonly policy: GenerationPolicy;

  constructor(
    session: Identity,
    private readonly executor: GenerationExecutor,
    policy: GenerationPolicy = GENERATION_POLICY,
  ) {
    const checked = decodeRequestIdentity({
      ...session,
      requestId: 'check',
      callerId: 'check',
      conversationId: 'check',
      attemptId: 'check',
    });
    this.session = Object.freeze({
      deploymentId: checked.deploymentId,
      sessionId: checked.sessionId,
      operationId: checked.operationId,
    });
    if (
      policy.activeLimit !== 4 ||
      policy.pendingLimit !== 8 ||
      [policy.queueMs, policy.generationMs, policy.cancellationMs].some(
        (ms) => !Number.isInteger(ms) || ms < 1 || ms > 2_147_483_647,
      )
    )
      throw new Error('INVALID_CONTROL');
    this.policy = Object.freeze({ ...policy });
  }

  /** Signals the host/service to confirm owned cleanup; this admission object never reopens. */
  get requiresCleanup(): boolean {
    return this.unsafe;
  }

  submit(input: RequestIdentity): AdmissionResult {
    if (this.closed) return Object.freeze({ accepted: false, code: 'NOT_READY' });
    let identity: RequestIdentity;
    try {
      identity = decodeRequestIdentity(input);
    } catch {
      return Object.freeze({ accepted: false, code: 'INVALID_CONTROL' });
    }
    if (
      identity.deploymentId !== this.session.deploymentId ||
      identity.sessionId !== this.session.sessionId ||
      identity.operationId !== this.session.operationId
    )
      return Object.freeze({ accepted: false, code: 'NOT_READY' });
    if (this.entries.has(identity.requestId))
      return Object.freeze({ accepted: false, code: 'INVALID_CONTROL' });
    if (
      [...this.entries.values()].some(
        (entry) => entry.identity.conversationId === identity.conversationId,
      )
    )
      return Object.freeze({ accepted: false, code: 'CONVERSATION_BUSY' });
    const running = this.activeCount();
    if (
      running >= this.policy.activeLimit &&
      this.entries.size - running >= this.policy.pendingLimit
    )
      return Object.freeze({ accepted: false, code: 'QUEUE_FULL' });
    let resolve!: (outcome: TerminalOutcome) => void;
    const done = new Promise<TerminalOutcome>((finish) => {
      resolve = finish;
    });
    const entry: Entry = { identity, state: 'queued', resolve, cancelSent: false };
    this.entries.set(identity.requestId, entry);
    if (running < this.policy.activeLimit) this.start(entry);
    else
      entry.timer = setTimeout(() => {
        this.finish(entry, { status: 'failed', reason: 'QUEUE_TIMEOUT' }, true);
      }, this.policy.queueMs);
    return Object.freeze({ accepted: true, identity, state: entry.state, done });
  }

  cancel(callerId: string, requestId: string): CancelResult {
    const entry = this.entries.get(requestId);
    if (!entry) return 'already-terminal';
    if (entry.identity.callerId !== callerId) return 'denied';
    if (entry.outcome) return 'already-terminal';
    this.cancelEntry(entry, { status: 'cancelled', reason: 'USER_CANCELLED' });
    return 'requested';
  }

  /** Closes admission before resolving pending work or requesting active cancellation. */
  close(reason: InterruptionReason): void {
    if (!['SESSION_STOPPED', 'ENGINE_EXITED', 'CHANNEL_LOST'].includes(reason))
      throw new Error('INVALID_CONTROL');
    if (this.closed) return;
    this.closed = true;
    for (const entry of [...this.entries.values()])
      this.cancelEntry(entry, { status: 'interrupted', reason });
  }

  /** At most twelve outstanding reservations; uncertain native work stays visible. */
  snapshot(): readonly RequestView[] {
    return Object.freeze(
      [...this.entries.values()].map((entry) =>
        Object.freeze({
          identity: entry.identity,
          state: entry.state,
          ...(entry.outcome ? { outcome: entry.outcome } : {}),
        }),
      ),
    );
  }

  private activeCount(): number {
    return [...this.entries.values()].filter((entry) => entry.state !== 'queued').length;
  }

  private start(entry: Entry): void {
    clearTimeout(entry.timer);
    delete entry.timer;
    entry.state = 'running';
    entry.timer = setTimeout(() => {
      this.cancelEntry(entry, { status: 'failed', reason: 'GENERATION_TIMEOUT' });
    }, this.policy.generationMs);
    try {
      entry.execution = this.executor.start(entry.identity);
    } catch {
      // Executor's synchronous-throw contract guarantees nothing was created.
      this.finish(entry, { status: 'failed', reason: 'START_FAILED' }, true);
      return;
    }
    void entry.execution.settled.then(
      (outcome) => {
        if (this.entries.get(entry.identity.requestId) !== entry) return;
        try {
          const validated = decodeOutcome(outcome);
          this.finish(entry, entry.cancelOutcome ?? validated, true);
        } catch {
          this.unconfirmed(entry, 'EXECUTION_FAILED');
        }
      },
      () => {
        this.unconfirmed(entry, 'EXECUTION_FAILED');
      },
    );
    // An executor can re-enter close() while synchronously creating its capability.
    if (entry.cancelOutcome) this.sendCancel(entry);
  }

  private cancelEntry(entry: Entry, outcome: TerminalOutcome): void {
    if (this.entries.get(entry.identity.requestId) !== entry || entry.cancelOutcome) return;
    if (entry.state === 'queued') {
      this.finish(entry, outcome, true);
      return;
    }
    clearTimeout(entry.timer);
    delete entry.timer;
    entry.state = 'cancelling';
    entry.cancelOutcome = Object.freeze(outcome);
    entry.cancellationTimer = setTimeout(() => {
      this.unconfirmed(entry, 'CANCEL_UNCONFIRMED');
    }, this.policy.cancellationMs);
    this.sendCancel(entry);
  }

  private sendCancel(entry: Entry): void {
    if (!entry.execution || entry.cancelSent) return;
    entry.cancelSent = true;
    try {
      const cancelled = entry.execution.cancel();
      if (cancelled)
        void cancelled.catch(() => {
          this.unconfirmed(entry, 'EXECUTION_FAILED');
        });
    } catch {
      this.unconfirmed(entry, 'EXECUTION_FAILED');
    }
  }

  private unconfirmed(entry: Entry, reason: 'CANCEL_UNCONFIRMED' | 'EXECUTION_FAILED'): void {
    if (this.entries.get(entry.identity.requestId) !== entry) return;
    this.unsafe = true;
    this.finish(entry, { status: 'failed', reason }, false);
    this.close('ENGINE_EXITED');
  }

  private finish(entry: Entry, outcome: TerminalOutcome, confirmed: boolean): void {
    if (this.entries.get(entry.identity.requestId) !== entry) return;
    clearTimeout(entry.timer);
    clearTimeout(entry.cancellationTimer);
    delete entry.timer;
    delete entry.cancellationTimer;
    if (!entry.outcome) {
      entry.outcome = Object.freeze(outcome);
      entry.resolve(entry.outcome);
    }
    if (confirmed) {
      this.entries.delete(entry.identity.requestId);
      this.drain();
    }
  }

  private drain(): void {
    if (this.closed) return;
    for (const entry of this.entries.values()) {
      if (this.activeCount() >= this.policy.activeLimit) return;
      if (entry.state === 'queued') this.start(entry);
    }
  }
}
