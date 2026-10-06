import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LIFECYCLE_POLICY } from './contracts.js';
import type { Event } from './contracts.js';
import { RuntimeSupervisor } from './supervisor.js';
import { fakeEngine } from '../../tests/fake-engine.js';
import type { OwnedEngine } from './engine-adapter.js';
const id = { deploymentId: 'd1', sessionId: 's1', operationId: 'op1' };
const selection = { ...id, packageId: 'p1', modelId: 'm1' };
const fixtures: ReturnType<typeof fakeEngine>[] = [];
function fixture(options: Parameters<typeof fakeEngine>[0] = {}) {
  const engine = fakeEngine(options);
  fixtures.push(engine);
  return engine;
}
async function ready(
  supervisor: RuntimeSupervisor,
  engine: ReturnType<typeof fakeEngine>,
  chosen = selection,
) {
  const loading = supervisor.load(chosen);
  engine.ready();
  return loading;
}
function partial(supervisor: RuntimeSupervisor) {
  supervisor.record({ type: 'request-started', ...id, requestId: 'r1' });
  supervisor.record({ type: 'text', ...id, requestId: 'r1', text: 'partial' });
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  try {
    for (const engine of fixtures) expect(engine.isAlive()).toBe(false);
  } finally {
    for (const engine of fixtures.splice(0)) engine.exit();
    vi.useRealTimers();
  }
});
describe('runtime supervisor', () => {
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648, 1.5])(
    'rejects unusable deadline override %s',
    (startupMs) => {
      const engine = fixture();
      expect(
        () => new RuntimeSupervisor('d1', engine.adapter, { ...LIFECYCLE_POLICY, startupMs }),
      ).toThrow('INVALID_CONTROL');
      expect(engine.launchCalls()).toBe(0);
    },
  );
  it('keeps a superseded load result correlated to its original operation', async () => {
    const first = fixture();
    const second = fixture();
    let launches = 0;
    const core = new RuntimeSupervisor(
      'd1',
      {
        launch: (chosen, signal) =>
          (++launches === 1 ? first : second).adapter.launch(chosen, signal),
      },
      LIFECYCLE_POLICY,
    );
    const oldLoading = core.load(selection);
    await vi.advanceTimersByTimeAsync(0);
    first.exit(1);
    await Promise.resolve();
    const newLoading = core.load({ ...selection, sessionId: 's2', operationId: 'op2' });
    second.ready();
    expect(await oldLoading).toMatchObject({ phase: 'failed', selection: { operationId: 'op1' } });
    expect((await newLoading).selection?.operationId).toBe('op2');
    await core.stop();
  });
  it('cleans up rejected readiness and reports a safe startup fault', async () => {
    const engine = fixture();
    const core = new RuntimeSupervisor(
      'd1',
      {
        async launch(chosen, signal) {
          const owned = await engine.adapter.launch(chosen, signal);
          return { ...owned, waitReady: () => Promise.reject(new Error('private backend error')) };
        },
      },
      LIFECYCLE_POLICY,
    );
    expect(await core.load(selection)).toMatchObject({
      phase: 'failed',
      fault: { code: 'START_FAILED', message: 'Engine startup failed' },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(engine.isAlive()).toBe(false);
  });
  it('releases an abandoned launch after its late rejection proves no owned instance exists', async () => {
    let rejectLaunch!: (reason: unknown) => void;
    const delayed = new Promise<OwnedEngine>((_resolve, reject) => {
      rejectLaunch = reject;
    });
    const engine = fixture();
    let launches = 0;
    const core = new RuntimeSupervisor(
      'd1',
      {
        launch: (chosen, signal) =>
          ++launches === 1 ? delayed : engine.adapter.launch(chosen, signal),
      },
      LIFECYCLE_POLICY,
    );
    const loading = core.load(selection);
    const stopping = core.stop();
    await vi.advanceTimersByTimeAsync(7_000);
    expect((await stopping).fault?.code).toBe('CLEANUP_FAILED');
    rejectLaunch(new Error('launch cancelled'));
    await loading;
    await vi.advanceTimersByTimeAsync(0);
    expect((await ready(core, engine, { ...selection, operationId: 'op2' })).phase).toBe('ready');
    await core.stop();
  });
  it('blocks new work while timed-out ownership cleanup is still pending', async () => {
    const engine = fixture({ graceful: 'hang' });
    const core = new RuntimeSupervisor('d1', engine.adapter, LIFECYCLE_POLICY);
    const loading = core.load(selection);
    await vi.advanceTimersByTimeAsync(180_000);
    expect((await loading).fault?.code).toBe('START_TIMEOUT');
    await expect(core.load({ ...selection, operationId: 'op2' })).rejects.toThrow('BUSY');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(engine.isAlive()).toBe(false);
    expect(core.snapshot().phase).toBe('failed');
  });
  it('cancels readiness and keeps stop terminal when readiness arrives concurrently', async () => {
    const engine = fixture();
    const core = new RuntimeSupervisor('d1', engine.adapter, LIFECYCLE_POLICY);
    const loading = core.load(selection);
    await vi.advanceTimersByTimeAsync(0);
    const stopping = core.stop();
    engine.ready();
    await stopping;
    await loading;
    expect(core.snapshot().phase).toBe('stopped');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('becomes ready only after correlated launch and readiness', async () => {
    const engine = fixture();
    const core = new RuntimeSupervisor('d1', engine.adapter, LIFECYCLE_POLICY);
    const loading = core.load(selection);
    await vi.advanceTimersByTimeAsync(0);
    expect(core.snapshot().phase).toBe('loading');
    engine.ready();
    expect((await loading).phase).toBe('ready');
    expect((await core.stop()).phase).toBe('stopped');
    expect(engine.isAlive()).toBe(false);
  });
  it('rejects wrong deployment and overlapping operations before launch', async () => {
    const engine = fixture();
    const core = new RuntimeSupervisor('d1', engine.adapter, LIFECYCLE_POLICY);
    await expect(core.load({ ...selection, deploymentId: 'd2' })).rejects.toThrow(
      'INVALID_TRANSITION',
    );
    const loading = core.load(selection);
    await expect(core.load({ ...selection, operationId: 'op2' })).rejects.toThrow('BUSY');
    engine.ready();
    await loading;
    expect(engine.launchCalls()).toBe(1);
    await core.stop();
  });
  it('reports launch rejection safely without hidden retry', async () => {
    let launches = 0;
    const core = new RuntimeSupervisor(
      'd1',
      {
        launch: () => {
          launches++;
          return Promise.reject(new Error('private executable'));
        },
      },
      LIFECYCLE_POLICY,
    );
    expect(await core.load(selection)).toMatchObject({
      phase: 'failed',
      fault: { code: 'START_FAILED' },
    });
    expect(core.snapshot().fault?.message).not.toContain('private executable');
    expect(launches).toBe(1);
  });
  it('handles a synchronous launch exception', async () => {
    const core = new RuntimeSupervisor(
      'd1',
      {
        launch: () => {
          throw new Error('private executable');
        },
      },
      LIFECYCLE_POLICY,
    );
    expect(await core.load(selection)).toMatchObject({
      phase: 'failed',
      fault: { code: 'START_FAILED' },
    });
  });
  it('fails exit before readiness and never publishes ready', async () => {
    const engine = fixture();
    const core = new RuntimeSupervisor('d1', engine.adapter, LIFECYCLE_POLICY);
    const loading = core.load(selection);
    await vi.advanceTimersByTimeAsync(0);
    engine.exit(1);
    engine.ready();
    expect(await loading).toMatchObject({ phase: 'failed', fault: { code: 'ENGINE_EXITED' } });
    expect(engine.isAlive()).toBe(false);
  });
  it('rejects a mismatched returned instance and cleans up that captured instance', async () => {
    const engine = fixture();
    const core = new RuntimeSupervisor(
      'd1',
      {
        async launch(chosen, signal) {
          return engine.adapter.launch({ ...chosen, modelId: 'wrong' }, signal);
        },
      },
      LIFECYCLE_POLICY,
    );
    engine.ready();
    expect((await core.load(selection)).phase).toBe('failed');
    await vi.advanceTimersByTimeAsync(0);
    expect(engine.isAlive()).toBe(false);
    expect(engine.requestStopCalls()).toBe(1);
  });
  it('bounds startup across launch and readiness at 180 seconds', async () => {
    const engine = fixture();
    const core = new RuntimeSupervisor('d1', engine.adapter, LIFECYCLE_POLICY);
    const loading = core.load(selection);
    await vi.advanceTimersByTimeAsync(179_999);
    expect(core.snapshot().phase).toBe('loading');
    await vi.advanceTimersByTimeAsync(1);
    expect(await loading).toMatchObject({ phase: 'failed', fault: { code: 'START_TIMEOUT' } });
    expect(engine.launchSignal()?.aborted).toBe(true);
    expect(engine.isAlive()).toBe(false);
  });
  it('preserves partial text on unexpected exit and ignores terminal callbacks', async () => {
    const engine = fixture();
    const core = new RuntimeSupervisor('d1', engine.adapter, LIFECYCLE_POLICY);
    await ready(core, engine);
    partial(core);
    engine.exit(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(core.snapshot()).toMatchObject({
      phase: 'failed',
      requests: { r1: { text: 'partial', status: 'interrupted' } },
    });
    core.record({ type: 'request-completed', ...id, requestId: 'r1' });
    expect(core.snapshot().requests.r1?.status).toBe('interrupted');
    expect(engine.launchCalls()).toBe(1);
  });
  it('forces after 5 seconds when graceful stop never settles', async () => {
    const engine = fixture({ graceful: 'hang', force: 'exit' });
    const core = new RuntimeSupervisor('d1', engine.adapter, LIFECYCLE_POLICY);
    await ready(core, engine);
    partial(core);
    const stopping = core.stop();
    expect(core.snapshot().requests.r1?.status).toBe('interrupted');
    await vi.advanceTimersByTimeAsync(4_999);
    expect(engine.forceStopCalls()).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect((await stopping).phase).toBe('stopped');
    expect(engine.forceStopCalls()).toBe(1);
    expect(engine.isAlive()).toBe(false);
  });
  it('does not force an engine whose exit is already confirmed', async () => {
    const engine = fixture({ graceful: 'hang' });
    const core = new RuntimeSupervisor('d1', engine.adapter, LIFECYCLE_POLICY);
    await ready(core, engine);
    const stopping = core.stop();
    engine.exit();
    expect((await stopping).phase).toBe('stopped');
    expect(engine.forceStopCalls()).toBe(0);
  });
  it('escalates graceful rejection and confirms forced exit', async () => {
    const engine = fixture({ graceful: 'reject', force: 'exit' });
    const core = new RuntimeSupervisor('d1', engine.adapter, LIFECYCLE_POLICY);
    await ready(core, engine);
    expect((await core.stop()).phase).toBe('stopped');
    expect(engine.forceStopCalls()).toBe(1);
  });
  it('does not treat a resolved stop method as exit confirmation', async () => {
    const engine = fixture();
    const core = new RuntimeSupervisor(
      'd1',
      {
        async launch(chosen, signal) {
          const owned = await engine.adapter.launch(chosen, signal);
          return {
            ...owned,
            requestStop: () => Promise.resolve(),
            forceStop: () => Promise.resolve(),
          };
        },
      },
      LIFECYCLE_POLICY,
    );
    await ready(core, engine);
    const stopping = core.stop();
    await vi.advanceTimersByTimeAsync(7_000);
    expect(await stopping).toMatchObject({ phase: 'failed', fault: { code: 'CLEANUP_FAILED' } });
    await expect(core.load({ ...selection, operationId: 'op2' })).rejects.toThrow('BUSY');
    engine.exit();
    await vi.advanceTimersByTimeAsync(0);
  });
  it('bounds a hung force method and retains unconfirmed ownership', async () => {
    const engine = fixture({ graceful: 'hang', force: 'hang' });
    const core = new RuntimeSupervisor('d1', engine.adapter, LIFECYCLE_POLICY);
    await ready(core, engine);
    const stopping = core.stop();
    await vi.advanceTimersByTimeAsync(6_999);
    expect(core.snapshot().phase).toBe('stopping');
    await vi.advanceTimersByTimeAsync(1);
    expect(await stopping).toMatchObject({ phase: 'failed', fault: { code: 'CLEANUP_FAILED' } });
    expect(engine.isAlive()).toBe(true);
    await expect(core.load({ ...selection, operationId: 'op2' })).rejects.toThrow('BUSY');
    engine.exit();
    await vi.advanceTimersByTimeAsync(0);
  });
  it('reports force rejection without clearing ownership', async () => {
    const engine = fixture({ graceful: 'reject', force: 'reject' });
    const core = new RuntimeSupervisor('d1', engine.adapter, LIFECYCLE_POLICY);
    await ready(core, engine);
    expect(await core.stop()).toMatchObject({ phase: 'failed', fault: { code: 'CLEANUP_FAILED' } });
    expect(engine.isAlive()).toBe(true);
    engine.exit();
    await vi.advanceTimersByTimeAsync(0);
  });
  it('shares duplicate stop cleanup', async () => {
    const engine = fixture({ graceful: 'hang' });
    const core = new RuntimeSupervisor('d1', engine.adapter, LIFECYCLE_POLICY);
    await ready(core, engine);
    const first = core.stop();
    const second = core.stop();
    expect(second).toBe(first);
    engine.exit();
    await first;
    expect(engine.requestStopCalls()).toBe(1);
    expect((await core.stop()).phase).toBe('stopped');
  });
  it('cleans up a delayed launch on stop without committing its readiness', async () => {
    const engine = fixture({ delayLaunch: true });
    const core = new RuntimeSupervisor('d1', engine.adapter, LIFECYCLE_POLICY);
    const loading = core.load(selection);
    await vi.advanceTimersByTimeAsync(0);
    const stopping = core.stop();
    engine.ready();
    engine.releaseLaunch();
    await stopping;
    await loading;
    expect(core.snapshot().phase).toBe('stopped');
    expect(engine.isAlive()).toBe(false);
    expect(engine.launchSignal()?.aborted).toBe(true);
  });
  it('bounds stop while launch is unresolved and cleans up the late instance', async () => {
    const engine = fixture({ delayLaunch: true });
    const core = new RuntimeSupervisor('d1', engine.adapter, LIFECYCLE_POLICY);
    const loading = core.load(selection);
    await vi.advanceTimersByTimeAsync(0);
    const stopping = core.stop();
    await vi.advanceTimersByTimeAsync(7_000);
    expect(await stopping).toMatchObject({ phase: 'failed', fault: { code: 'CLEANUP_FAILED' } });
    await expect(core.load({ ...selection, operationId: 'op2' })).rejects.toThrow('BUSY');
    engine.ready();
    engine.releaseLaunch();
    await loading;
    await vi.advanceTimersByTimeAsync(0);
    expect(engine.isAlive()).toBe(false);
    expect(engine.requestStopCalls()).toBe(1);
  });
  it('leaves an independent deployment untouched during forced cleanup', async () => {
    const first = fixture({ graceful: 'hang' });
    const second = fixture();
    const one = new RuntimeSupervisor('d1', first.adapter, LIFECYCLE_POLICY);
    const two = new RuntimeSupervisor('d2', second.adapter, LIFECYCLE_POLICY);
    await ready(one, first);
    await ready(two, second, { ...selection, deploymentId: 'd2' });
    const stopping = one.stop();
    await vi.advanceTimersByTimeAsync(5_000);
    await stopping;
    expect(two.snapshot().phase).toBe('ready');
    expect(second.isAlive()).toBe(true);
    expect(second.forceStopCalls()).toBe(0);
    await two.stop();
  });
  it('reloads only explicitly and ignores readiness from the abandoned attempt', async () => {
    const first = fixture();
    const second = fixture();
    let launches = 0;
    const core = new RuntimeSupervisor(
      'd1',
      {
        launch: (chosen, signal) =>
          (++launches === 1 ? first : second).adapter.launch(chosen, signal),
      },
      LIFECYCLE_POLICY,
    );
    const loading = core.load(selection);
    await vi.advanceTimersByTimeAsync(0);
    first.exit(1);
    await loading;
    await expect(core.load(selection)).rejects.toThrow('INVALID_TRANSITION');
    await ready(core, second, { ...selection, sessionId: 's2', operationId: 'op2' });
    first.ready();
    await vi.advanceTimersByTimeAsync(0);
    expect(core.snapshot().selection?.operationId).toBe('op2');
    expect(core.snapshot().phase).toBe('ready');
    await core.stop();
  });
  it('does not allow record callers to forge lifecycle events', async () => {
    const engine = fixture();
    const core = new RuntimeSupervisor('d1', engine.adapter, LIFECYCLE_POLICY);
    expect(() => core.record({ type: 'ready', ...id })).toThrow('INVALID_CONTROL');
    expect(() => core.record({ type: 'request-started', ...id, requestId: 'r1' })).toThrow(
      'NOT_READY',
    );
    await ready(core, engine);
    expect(() =>
      core.record({ type: 'text', ...id, requestId: 'r1', text: 1 } as unknown as Event),
    ).toThrow('INVALID_CONTROL');
    await core.stop();
  });
});
