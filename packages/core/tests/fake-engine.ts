import type { EngineAdapter, EngineExit, OwnedEngine } from '../src/runtime/engine-adapter.js';
import type { Selection } from '../src/runtime/contracts.js';
type Behavior = 'exit' | 'hang' | 'reject';
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
/** In-memory engine only; can deliberately ignore cancellation to exercise late ownership. */
export function fakeEngine(
  options: { graceful?: Behavior; force?: Behavior; delayLaunch?: boolean } = {},
) {
  const readiness = deferred<void>();
  const exitReceipt = deferred<EngineExit>();
  const launch = deferred<void>();
  let gracefulCalls = 0;
  let forcedCalls = 0;
  let launches = 0;
  let alive = false;
  let signal: AbortSignal | null = null;
  function exit(code = 0) {
    alive = false;
    exitReceipt.resolve({ code, signal: null });
  }
  function act(behavior: Behavior): Promise<void> {
    if (behavior === 'reject') return Promise.reject(new Error('fixture failure'));
    if (behavior === 'hang') return new Promise(() => {});
    exit();
    return Promise.resolve();
  }
  const adapter: EngineAdapter = {
    async launch(selection: Selection, abortSignal: AbortSignal): Promise<OwnedEngine> {
      launches++;
      signal = abortSignal;
      if (options.delayLaunch) await launch.promise;
      alive = true;
      return {
        selection: Object.freeze({ ...selection }),
        exited: exitReceipt.promise,
        waitReady: () => readiness.promise,
        requestStop: () => {
          gracefulCalls++;
          return act(options.graceful ?? 'exit');
        },
        forceStop: () => {
          forcedCalls++;
          return act(options.force ?? 'exit');
        },
      };
    },
  };
  return {
    adapter,
    ready: () => readiness.resolve(),
    exit,
    releaseLaunch: () => launch.resolve(),
    forceStopCalls: () => forcedCalls,
    requestStopCalls: () => gracefulCalls,
    launchCalls: () => launches,
    isAlive: () => alive,
    launchSignal: () => signal,
  };
}
