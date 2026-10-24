import { decodeEvent } from './contracts.js';
import type { Event, FaultCode, Identity, Selection, Snapshot } from './contracts.js';
import type { EngineAdapter, OwnedEngine } from './engine-adapter.js';
import { initialSnapshot, matchesIdentity, transition } from './lifecycle.js';

type Policy = Readonly<{ startupMs: number; gracefulStopMs: number; forcedExitMs: number }>;
interface Attempt {
  readonly selection: Selection;
  readonly controller: AbortController;
  readonly launch: Promise<OwnedEngine>;
  engine: OwnedEngine | null;
  launchSettled: boolean;
  exited: boolean;
  stopRequested: boolean;
  cleanup: Promise<Snapshot> | null;
  cleanupFinished: boolean;
  result: Snapshot;
}

/**
 * Supervises one deployment through injected instance capabilities, with no native launcher.
 * @remarks Snapshot results report failures as state; invalid commands reject/throw safe codes.
 * An unconfirmed or unresolved instance blocks further loads. Recovery is always explicit.
 */
export class RuntimeSupervisor {
  private state: Snapshot;
  private attempt: Attempt | null = null;
  private readonly used = new Set<string>();
  private readonly policy: Policy;

  /** Policy values are milliseconds; overrides exist for test dependency injection only. */
  constructor(
    deploymentId: string,
    private readonly adapter: EngineAdapter,
    policy: Policy,
  ) {
    this.state = initialSnapshot(deploymentId);
    if (
      [policy.startupMs, policy.gracefulStopMs, policy.forcedExitMs].some(
        (ms) => !Number.isInteger(ms) || ms <= 0 || ms > 2_147_483_647,
      )
    )
      throw new Error('INVALID_CONTROL');
    this.policy = Object.freeze({ ...policy });
  }

  /**
   * Starts a fresh correlated operation. Startup failure returns a failed snapshot; cleanup
   * may continue after the startup deadline and keeps admission closed until exit is confirmed.
   * startupMs is an optional trusted-owner budget, never a serialized control field.
   * @throws Rejected INVALID_CONTROL, INVALID_TRANSITION or BUSY for invalid/conflicting commands.
   */
  async load(selection: Selection, startupMs = this.policy.startupMs): Promise<Snapshot> {
    const event = decodeEvent(JSON.stringify({ type: 'start', selection }));
    if (event.type !== 'start') throw new Error('INVALID_CONTROL');
    const chosen = event.selection;
    if (chosen.deploymentId !== this.state.deploymentId) throw new Error('INVALID_TRANSITION');
    if (this.attempt !== null) throw new Error('BUSY');
    if (!Number.isInteger(startupMs) || startupMs <= 0 || startupMs > 2_147_483_647)
      throw new Error('INVALID_CONTROL');
    const key = JSON.stringify(identity(chosen));
    if (this.used.has(key)) throw new Error('INVALID_TRANSITION');
    this.state = transition(this.state, event);
    this.used.add(key);
    const controller = new AbortController();
    const launch = Promise.resolve().then(() => this.adapter.launch(chosen, controller.signal));
    const attempt: Attempt = {
      selection: chosen,
      controller,
      launch,
      engine: null,
      launchSettled: false,
      exited: false,
      stopRequested: false,
      cleanup: null,
      cleanupFinished: false,
      result: this.state,
    };
    this.attempt = attempt;
    // Keep observing launch after timeout/cancellation: a late instance is still ours to clean up.
    void launch.then(
      (engine) => this.capture(attempt, engine),
      () => {
        attempt.launchSettled = true;
        // A rejection after the cleanup deadline proves there is no late instance to retain.
        if (attempt.cleanupFinished) this.release(attempt);
      },
    );
    try {
      await within(this.start(attempt), startupMs, 'START_TIMEOUT', controller.signal);
    } catch (error: unknown) {
      if (this.attempt === attempt && !attempt.stopRequested) {
        const code =
          error instanceof Error && error.message === 'START_TIMEOUT'
            ? 'START_TIMEOUT'
            : 'START_FAILED';
        this.fail(attempt, code);
        controller.abort();
        void this.clean(attempt);
      }
    }
    return attempt.result;
  }

  /**
   * Closes admission immediately, shares duplicate cleanup and confirms owned exit.
   * @returns Stopped on confirmed cleanup, or failed/CLEANUP_FAILED with ownership retained.
   * A late launch remains captured even if the total cleanup deadline expires.
   */
  stop(): Promise<Snapshot> {
    const attempt = this.attempt;
    if (!attempt) {
      if (this.state.phase === 'failed' && this.state.selection) {
        this.publish({ type: 'stopping', ...identity(this.state.selection) });
        this.publish({ type: 'stopped', ...identity(this.state.selection) });
      }
      return Promise.resolve(this.state);
    }
    if (!attempt.stopRequested || this.state.phase === 'failed') {
      attempt.stopRequested = true;
      this.publish({ type: 'stopping', ...identity(attempt.selection) });
      attempt.controller.abort();
    }
    return this.clean(attempt);
  }

  /** Returns immutable in-memory state; this does not establish durable transcript retention. */
  snapshot(): Snapshot {
    return this.state;
  }

  /** Accepts request records only; callers cannot manufacture readiness, exit or launch events. */
  record(input: Event): void {
    const event = decodeEvent(JSON.stringify(input));
    if (
      event.type !== 'request-started' &&
      event.type !== 'text' &&
      event.type !== 'request-completed'
    )
      throw new Error('INVALID_CONTROL');
    if (event.type === 'request-started' && this.state.phase !== 'ready')
      throw new Error('NOT_READY');
    this.publish(event);
  }

  private publish(event: Event): void {
    this.state = transition(this.state, event);
    if (this.attempt) this.attempt.result = this.state;
  }

  private async start(attempt: Attempt): Promise<void> {
    const engine = await attempt.launch;
    if (this.attempt !== attempt || attempt.controller.signal.aborted || attempt.exited) return;
    if (
      !matchesIdentity(attempt.selection, engine.selection) ||
      engine.selection.packageId !== attempt.selection.packageId ||
      engine.selection.modelId !== attempt.selection.modelId
    )
      throw new Error('START_FAILED');
    this.publish({ type: 'spawned', ...identity(attempt.selection) });
    await Promise.race([
      Promise.resolve().then(() => engine.waitReady(attempt.controller.signal)),
      engine.exited.then(() => {
        throw new Error('ENGINE_EXITED');
      }),
    ]);
    if (this.attempt === attempt && !attempt.controller.signal.aborted && !attempt.exited)
      this.publish({ type: 'ready', ...identity(attempt.selection) });
  }

  private capture(attempt: Attempt, engine: OwnedEngine): void {
    attempt.engine = engine;
    attempt.launchSettled = true;
    void engine.exited.then(
      () => {
        attempt.exited = true;
        if (this.attempt !== attempt) return;
        if (!attempt.stopRequested) {
          this.fail(attempt, 'ENGINE_EXITED');
          attempt.controller.abort();
        }
        if (attempt.cleanup === null) this.attempt = null;
      },
      () => {
        if (this.attempt === attempt) {
          this.fail(attempt, 'CLEANUP_FAILED');
          attempt.controller.abort();
          void this.clean(attempt);
        }
      },
    );
    if (attempt.controller.signal.aborted && attempt.cleanupFinished) void this.clean(attempt);
  }

  private fail(attempt: Attempt, code: FaultCode): void {
    if (this.attempt !== attempt) return;
    const fault = Object.freeze({
      code,
      message:
        code === 'ENGINE_EXITED'
          ? 'Owned engine exited'
          : code === 'START_TIMEOUT'
            ? 'Startup deadline exceeded'
            : code === 'CLEANUP_FAILED'
              ? 'Owned exit could not be confirmed'
              : 'Engine startup failed',
    });
    // A cleanup failure is a new ownership failure, rather than a duplicate engine-exit receipt.
    if (this.state.phase === 'failed' && code === 'CLEANUP_FAILED') {
      this.state = Object.freeze({ ...this.state, fault });
      attempt.result = this.state;
    } else this.publish({ type: 'failed', ...identity(attempt.selection), fault });
  }

  private clean(attempt: Attempt): Promise<Snapshot> {
    if (attempt.cleanup) return attempt.cleanup;
    attempt.cleanupFinished = false;
    const cleanup = this.teardown(attempt).finally(() => {
      attempt.cleanup = null;
      attempt.cleanupFinished = true;
    });
    attempt.cleanup = cleanup;
    return cleanup;
  }

  private async teardown(attempt: Attempt): Promise<Snapshot> {
    const began = Date.now();
    const gracefulEnd = began + this.policy.gracefulStopMs;
    const forcedEnd = gracefulEnd + this.policy.forcedExitMs;
    try {
      let engine = attempt.engine;
      if (!engine) {
        try {
          engine = await within(attempt.launch, remaining(gracefulEnd), 'CLEANUP_FAILED');
        } catch {
          engine = await within(attempt.launch, remaining(forcedEnd), 'CLEANUP_FAILED');
        }
      }
      if (!attempt.exited) {
        try {
          await within(stopAndConfirm(engine, false), remaining(gracefulEnd), 'CLEANUP_FAILED');
        } catch {
          await within(
            stopAndConfirm(engine, true),
            Math.min(this.policy.forcedExitMs, remaining(forcedEnd)),
            'CLEANUP_FAILED',
          );
        }
      }
      this.release(attempt);
    } catch {
      if ((attempt.launchSettled && attempt.engine === null) || attempt.exited)
        this.release(attempt);
      else this.fail(attempt, 'CLEANUP_FAILED');
    }
    return attempt.result;
  }

  private release(attempt: Attempt): void {
    if (this.attempt !== attempt) return;
    if (attempt.stopRequested && this.state.phase === 'stopping')
      this.publish({ type: 'stopped', ...identity(attempt.selection) });
    this.attempt = null;
  }
}

function identity(selection: Selection): Identity {
  return {
    deploymentId: selection.deploymentId,
    sessionId: selection.sessionId,
    operationId: selection.operationId,
  };
}
function remaining(deadline: number): number {
  return Math.max(0, deadline - Date.now());
}
function stopAndConfirm(engine: OwnedEngine, force: boolean): Promise<unknown> {
  const stop = Promise.resolve().then(() => (force ? engine.forceStop() : engine.requestStop()));
  // Exit is sufficient even if the stop call hangs; a fulfilled stop call is never sufficient.
  return Promise.race([engine.exited, stop.then(() => engine.exited)]);
}
async function within<T>(
  work: Promise<T>,
  ms: number,
  fault: FaultCode,
  signal?: AbortSignal,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(fault)), ms);
    abort = () => reject(new Error('INVALID_TRANSITION'));
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (abort) signal?.removeEventListener('abort', abort);
  }
}
