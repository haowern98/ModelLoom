import { expect, it, vi } from 'vitest';
import { fixtureSession } from './session.js';
import { fakeEngine } from '../../tests/fake-engine.js';

it.each([false, true])('keeps the startup deadline scoped to remote loads: %s', async (remote) => {
  vi.useFakeTimers();
  const engine = fakeEngine();
  const session = fixtureSession(engine.adapter, () => {});
  const selection = {
    deploymentId: 'fixture-host',
    sessionId: 's1',
    operationId: 'op1',
    packageId: 'p1',
    modelId: 'm1',
  };
  try {
    const loading = session.handle(JSON.stringify({ id: 1, action: 'load', selection }), remote);
    await vi.advanceTimersByTimeAsync(310_000);
    expect(session.core.snapshot().phase).toBe(remote ? 'loading' : 'failed');
    if (remote) engine.ready();
    expect((await loading).reply.snapshot?.phase).toBe(remote ? 'ready' : 'failed');
    await session.core.stop();
    expect(engine.isAlive()).toBe(false);
  } finally {
    engine.exit();
    vi.useRealTimers();
  }
});

it('bounds a remote load and rejects a deadline supplied in serialized control', async () => {
  vi.useFakeTimers();
  const engine = fakeEngine();
  const session = fixtureSession(engine.adapter, () => {});
  const selection = {
    deploymentId: 'fixture-host',
    sessionId: 's1',
    operationId: 'op1',
    packageId: 'p1',
    modelId: 'm1',
  };
  try {
    expect(
      (
        await session.handle(
          JSON.stringify({ id: 1, action: 'load', selection, startupMs: 1_800_000 }),
        )
      ).reply.error,
    ).toBe('INVALID_CONTROL');
    expect(engine.launchCalls()).toBe(0);
    const loading = session.handle(JSON.stringify({ id: 2, action: 'load', selection }), true);
    await vi.advanceTimersByTimeAsync(1_799_999);
    expect(session.core.snapshot().phase).toBe('loading');
    await vi.advanceTimersByTimeAsync(1);
    expect((await loading).reply.snapshot?.fault?.code).toBe('START_TIMEOUT');
    await session.core.stop();
    expect(engine.isAlive()).toBe(false);
  } finally {
    engine.exit();
    vi.useRealTimers();
  }
});
it('keeps a live desktop identity distinct from the fixture deployment', async () => {
  const session = Reflect.apply(fixtureSession, undefined, [
    { launch: () => Promise.reject(new Error('START_FAILED')) },
    () => {},
    undefined,
    'desktop-development',
  ]);
  const result = await session.handle(JSON.stringify({ id: 1, action: 'snapshot' }));
  expect(result.reply.snapshot?.deploymentId).toBe('desktop-development');
  const fixtureSelection = {
    deploymentId: 'fixture-host',
    sessionId: 'session',
    operationId: 'operation',
    modelId: 'model',
    packageId: 'package',
  };
  expect(
    (await session.handle(JSON.stringify({ id: 2, action: 'load', selection: fixtureSelection })))
      .reply.error,
  ).toBe('INVALID_TRANSITION');
});
