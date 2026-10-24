import { expect, it, vi } from 'vitest';
import { withPeerActivity } from './peer-activity-transport.js';

const identity = {
  kind: 'api' as const,
  deploymentId: 'desktop',
  sessionId: 'session',
  operationId: 'load',
  callerId: 'http',
  requestId: 'request',
};
const outcome = { status: 'completed' as const, reason: 'STOP' as const };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

it('waits for busy acknowledgement and keeps overlapping native work busy', async () => {
  const ack = deferred<void>(),
    count = deferred<number>(),
    generated = deferred<typeof outcome>();
  const busy = vi.fn((value: boolean) => (value ? ack.promise : Promise.resolve()));
  const native = {
    tokenCount: vi.fn(() => count.promise),
    start: vi.fn(() => ({ settled: generated.promise, cancel() {} })),
  };
  const transport = withPeerActivity(native, busy);
  const counted = transport.tokenCount([], new AbortController().signal);
  const execution = transport.start(identity, [], () => undefined);
  await Promise.resolve();
  expect(native.tokenCount).not.toHaveBeenCalled();
  expect(native.start).not.toHaveBeenCalled();
  ack.resolve();
  await vi.waitFor(() => expect(native.start).toHaveBeenCalledOnce());
  count.resolve(2);
  expect(await counted).toBe(2);
  expect(busy).not.toHaveBeenCalledWith(false);
  generated.resolve(outcome);
  expect(await execution.settled).toEqual(outcome);
  expect(busy.mock.calls.map(([value]) => value)).toEqual([true, false]);
});

it('cancels before acknowledgement without dispatching native work', async () => {
  const ack = deferred<void>();
  const busy = vi.fn((value: boolean) => (value ? ack.promise : Promise.resolve()));
  const native = {
    tokenCount: () => Promise.resolve(0),
    start: vi.fn(() => ({ settled: Promise.resolve(outcome), cancel() {} })),
  };
  const execution = withPeerActivity(native, busy).start(identity, [], () => undefined);
  await execution.cancel();
  ack.resolve();
  expect(await execution.settled).toEqual({ status: 'cancelled', reason: 'USER_CANCELLED' });
  expect(native.start).not.toHaveBeenCalled();
  expect(busy).toHaveBeenLastCalledWith(false);
});

it('keeps busy after rejected native settlement', async () => {
  const busy = vi.fn(() => Promise.resolve());
  const native = {
    tokenCount: () => Promise.resolve(0),
    start: () => ({ settled: Promise.reject(Error('CLEANUP_FAILED')), cancel() {} }),
  };
  await expect(
    withPeerActivity(native, busy).start(identity, [], () => undefined).settled,
  ).rejects.toThrow('CLEANUP_FAILED');
  expect(busy).toHaveBeenCalledOnce();
  expect(busy).toHaveBeenCalledWith(true);
});

it('forwards cancellation after dispatch and joins the idle acknowledgement', async () => {
  const idle = deferred<void>(),
    finished = deferred<typeof outcome>(),
    cancel = vi.fn();
  const native = {
    tokenCount: () => Promise.resolve(0),
    start: vi.fn(() => ({ settled: finished.promise, cancel })),
  };
  const busy = vi.fn((value: boolean) => (value ? Promise.resolve() : idle.promise));
  const execution = withPeerActivity(native, busy).start(identity, [], () => undefined);
  await vi.waitFor(() => expect(native.start).toHaveBeenCalledOnce());
  await execution.cancel();
  expect(cancel).toHaveBeenCalledOnce();
  let settled = false;
  void execution.settled.then(() => {
    settled = true;
  });
  finished.resolve(outcome);
  await vi.waitFor(() => expect(busy).toHaveBeenCalledWith(false));
  expect(settled).toBe(false);
  idle.resolve();
  expect(await execution.settled).toEqual(outcome);
});
