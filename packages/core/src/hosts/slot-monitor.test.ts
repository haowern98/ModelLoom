import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { OwnedSlotMonitor } from './slot-monitor.js';
import type { SlotStatus } from './slot-status.js';
import { GenerationAdmission } from '../generation/admission.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
async function fixture(count = 1, observationMs = 5000) {
  let status: readonly SlotStatus[] = Array.from({ length: count }, (_, id) => ({
    id,
    processing: false,
    task: null,
  }));
  let owns = true,
    cleanup = 0,
    reads = 0;
  let reader: ((signal: AbortSignal) => Promise<readonly SlotStatus[]>) | undefined;
  const exit = deferred<void>();
  const monitor = new OwnedSlotMonitor(
    count,
    (signal) => {
      reads++;
      return reader ? reader(signal) : Promise.resolve(status);
    },
    () => owns,
    exit.promise,
    () => {
      cleanup++;
    },
    observationMs,
  );
  await monitor.initialize();
  return {
    monitor,
    exit,
    status: (value: readonly SlotStatus[]) => {
      status = value;
    },
    reader: (value: typeof reader) => {
      reader = value;
    },
    loseOwner: () => {
      owns = false;
    },
    cleanup: () => cleanup,
    reads: () => reads,
  };
}
const tick = () => vi.advanceTimersByTimeAsync(100);
it('retains a remote reservation through a slow status response without stopping generation', async () => {
  const f = await fixture(1, 300_000);
  const stream = deferred<'terminal' | 'aborted'>();
  const status = deferred<readonly SlotStatus[]>();
  f.reader(() => status.promise);
  const done = f.monitor.start(() => stream.promise);
  await vi.advanceTimersByTimeAsync(6000);
  expect(f.cleanup()).toBe(0);
  expect(f.reads()).toBe(2);
  status.resolve([{ id: 0, processing: true, task: 70 }]);
  await vi.advanceTimersByTimeAsync(0);
  f.reader(undefined);
  f.status([{ id: 0, processing: false, task: 70 }]);
  stream.resolve('terminal');
  await tick();
  await expect(done).resolves.toBe('released');
});
it('still closes a hung remote observation at its captured generation deadline', async () => {
  const f = await fixture(1, 300_000);
  const stream = deferred<'terminal' | 'aborted'>();
  f.reader(() => new Promise(() => undefined));
  const done = f.monitor.start(() => stream.promise);
  const failed = expect(done).rejects.toThrow('STATUS_UNCONFIRMED');
  await tick();
  await vi.advanceTimersByTimeAsync(299_999);
  expect(f.cleanup()).toBe(0);
  await vi.advanceTimersByTimeAsync(1);
  await failed;
  expect(f.cleanup()).toBe(1);
});
it('holds capacity after a valid final response until a later native idle check', async () => {
  const f = await fixture();
  const stream = deferred<'terminal' | 'aborted'>();
  let released = false;
  const done = f.monitor.start((slot) => {
    expect(slot).toBe(0);
    return stream.promise;
  });
  void done.then(() => {
    released = true;
  });
  f.status([{ id: 0, processing: true, task: 20 }]);
  await tick();
  stream.resolve('terminal');
  await tick();
  expect(released).toBe(false);
  f.status([{ id: 0, processing: false, task: 20 }]);
  await tick();
  await expect(done).resolves.toBe('released');
});
it('cannot use a status request started before stream end as a receipt', async () => {
  const f = await fixture();
  const stream = deferred<'terminal' | 'aborted'>();
  let released = false;
  const done = f.monitor.start(() => stream.promise);
  void done.then(() => {
    released = true;
  });
  const status = deferred<readonly SlotStatus[]>();
  f.reader(() => status.promise);
  await tick();
  stream.resolve('terminal');
  await vi.advanceTimersByTimeAsync(0);
  status.resolve([{ id: 0, processing: false, task: 20 }]);
  await vi.advanceTimersByTimeAsync(0);
  expect(released).toBe(false);
  f.reader(undefined);
  f.status([{ id: 0, processing: false, task: 20 }]);
  await tick();
  await expect(done).resolves.toBe('released');
});
it('idle before dispatch cannot settle cancelled work that never appeared', async () => {
  const f = await fixture();
  const done = f.monitor.start(() => Promise.resolve('aborted'));
  const failed = expect(done).rejects.toThrow('STATUS_UNCONFIRMED');
  await vi.advanceTimersByTimeAsync(5000);
  await failed;
  expect(f.cleanup()).toBe(1);
  expect(() => f.monitor.start(() => Promise.resolve('terminal'))).toThrow('STATUS_UNCONFIRMED');
});
it('confirms cancellation before the first token after observing its task', async () => {
  const f = await fixture();
  const stream = deferred<'terminal' | 'aborted'>();
  const done = f.monitor.start(() => stream.promise);
  f.status([{ id: 0, processing: true, task: 8 }]);
  await tick();
  stream.resolve('aborted');
  f.status([{ id: 0, processing: false, task: 8 }]);
  await tick();
  await expect(done).resolves.toBe('released');
});
it('holds aborted work until its observed task stops processing', async () => {
  const f = await fixture();
  const stream = deferred<'terminal' | 'aborted'>();
  let released = false;
  const done = f.monitor.start(() => stream.promise);
  void done.then(() => {
    released = true;
  });
  f.status([{ id: 0, processing: true, task: 9 }]);
  await tick();
  stream.resolve('aborted');
  await tick();
  expect(released).toBe(false);
  f.status([{ id: 0, processing: false, task: 9 }]);
  await tick();
  await expect(done).resolves.toBe('released');
});
it('allows a short valid stream missed by polling only with its later task and idle state', async () => {
  const f = await fixture();
  const done = f.monitor.start(() => Promise.resolve('terminal'));
  f.status([{ id: 0, processing: false, task: 21 }]);
  await tick();
  await expect(done).resolves.toBe('released');
});
it.each(['task', 'slots', 'owner', 'reader'] as const)(
  'fails closed on %s mismatch',
  async (kind) => {
    const f = await fixture();
    const stream = deferred<'terminal' | 'aborted'>();
    const done = f.monitor.start(() => stream.promise);
    const failed = expect(done).rejects.toThrow('STATUS_UNCONFIRMED');
    f.status([{ id: 0, processing: true, task: 22 }]);
    await tick();
    if (kind === 'task') f.status([{ id: 0, processing: false, task: 23 }]);
    if (kind === 'slots') f.status([]);
    if (kind === 'owner') f.loseOwner();
    if (kind === 'reader') f.reader(() => Promise.reject(new Error('secret')));
    await tick();
    await failed;
    expect(f.cleanup()).toBe(1);
    expect(() => f.monitor.start(() => Promise.resolve('terminal'))).toThrow('STATUS_UNCONFIRMED');
  },
);
it('rejects reused task IDs after a reservation has settled', async () => {
  const f = await fixture();
  f.status([{ id: 0, processing: false, task: 24 }]);
  await expectAfterTick(
    f.monitor.start(() => Promise.resolve('terminal')),
    'released',
  );
  const stream = deferred<'terminal' | 'aborted'>();
  const done = f.monitor.start(() => stream.promise);
  const failed = expect(done).rejects.toThrow('STATUS_UNCONFIRMED');
  f.status([{ id: 0, processing: true, task: 24 }]);
  await tick();
  await failed;
});
async function expectAfterTick(done: Promise<string>, expected: string) {
  await tick();
  await expect(done).resolves.toBe(expected);
}
it('has one shared poll in flight and no backlog while four streams run', async () => {
  const f = await fixture(4);
  const streams = Array.from({ length: 4 }, () => deferred<'terminal' | 'aborted'>());
  const done = streams.map((stream) => f.monitor.start(() => stream.promise));
  const status = deferred<readonly SlotStatus[]>();
  f.reader(() => status.promise);
  await vi.advanceTimersByTimeAsync(1000);
  expect(f.reads()).toBe(2); // initial check plus one active poll
  status.resolve(streams.map((_, id) => ({ id, processing: true, task: 30 + id })));
  await vi.advanceTimersByTimeAsync(0);
  f.reader(undefined);
  f.status(streams.map((_, id) => ({ id, processing: false, task: 30 + id })));
  streams.forEach((stream) => stream.resolve('terminal'));
  await tick();
  await expect(Promise.all(done)).resolves.toEqual([
    'released',
    'released',
    'released',
    'released',
  ]);
});
it('a hung status request times out and ignores its eventual stale response', async () => {
  const f = await fixture();
  const status = deferred<readonly SlotStatus[]>();
  f.reader(() => status.promise);
  const done = f.monitor.start(() => Promise.resolve('terminal'));
  const failed = expect(done).rejects.toThrow('STATUS_UNCONFIRMED');
  await vi.advanceTimersByTimeAsync(5000);
  await failed;
  status.resolve([{ id: 0, processing: false, task: 25 }]);
  await tick();
  expect(f.cleanup()).toBe(1);
  expect(() => f.monitor.start(() => Promise.resolve('terminal'))).toThrow('STATUS_UNCONFIRMED');
});
it('captured engine exit interrupts reservations and never grants new admission', async () => {
  const f = await fixture();
  const stream = deferred<'terminal' | 'aborted'>();
  const done = f.monitor.start(() => stream.promise);
  f.exit.resolve();
  await expect(done).resolves.toBe('engine-exited');
  expect(() => f.monitor.start(() => Promise.resolve('terminal'))).toThrow('STATUS_UNCONFIRMED');
  expect(f.cleanup()).toBe(0);
});
it('rejects unexpected processing in an unreserved native slot', async () => {
  const f = await fixture(2);
  const done = f.monitor.start(() => deferred<'terminal' | 'aborted'>().promise);
  const failed = expect(done).rejects.toThrow('STATUS_UNCONFIRMED');
  f.status([
    { id: 0, processing: true, task: 26 },
    { id: 1, processing: true, task: 27 },
  ]);
  await tick();
  await failed;
});
it('a caller-shaped object cannot supply a release receipt', async () => {
  const f = await fixture();
  const done = f.monitor.start(() => Promise.resolve({ state: 'completed', id_slot: 0 } as never));
  const failed = expect(done).rejects.toThrow('STATUS_UNCONFIRMED');
  await vi.advanceTimersByTimeAsync(0);
  await failed;
});
it('keeps the real core queue pending until the captured native reservation releases', async () => {
  const f = await fixture(4);
  const streams = Array.from({ length: 5 }, () => deferred<'terminal' | 'aborted'>());
  let started = 0;
  const session = { deploymentId: 'owner', sessionId: 'session', operationId: 'load' };
  const admission = new GenerationAdmission(session, {
    start() {
      const stream = streams[started++]!;
      const release = f.monitor.start(() => stream.promise);
      return {
        settled: release.then((receipt) =>
          receipt === 'released'
            ? { status: 'completed' as const, reason: 'STOP' as const }
            : { status: 'interrupted' as const, reason: 'ENGINE_EXITED' as const },
        ),
        cancel: () => {
          stream.resolve('aborted');
        },
      };
    },
  });
  for (let i = 0; i < 5; i++) {
    expect(
      admission.submit({
        ...session,
        callerId: 'caller',
        requestId: `request${i}`,
        conversationId: `conversation${i}`,
        attemptId: `attempt${i}`,
      }).accepted,
    ).toBe(true);
  }
  expect(started).toBe(4);
  f.status(Array.from({ length: 4 }, (_, id) => ({ id, processing: true, task: 50 + id })));
  await tick();
  streams[0]!.resolve('terminal');
  await tick();
  expect(started).toBe(4);
  f.status(Array.from({ length: 4 }, (_, id) => ({ id, processing: id !== 0, task: 50 + id })));
  await tick();
  expect(started).toBe(5);
  f.exit.resolve();
  await vi.advanceTimersByTimeAsync(0);
});
it('refuses initialization with native work already present', async () => {
  const exit = deferred<void>();
  let cleanup = 0;
  const monitor = new OwnedSlotMonitor(
    1,
    () => Promise.resolve([{ id: 0, processing: true, task: 99 }]),
    () => true,
    exit.promise,
    () => {
      cleanup++;
    },
  );
  await expect(monitor.initialize()).rejects.toThrow('STATUS_UNCONFIRMED');
  expect(() => monitor.start(() => Promise.resolve('terminal'))).toThrow('STATUS_UNCONFIRMED');
  expect(cleanup).toBe(1);
});
it('retains failed capacity even when the owned cleanup callback throws', async () => {
  const exit = deferred<void>();
  let status: readonly SlotStatus[] = [{ id: 0, processing: false, task: null }];
  const monitor = new OwnedSlotMonitor(
    1,
    () => Promise.resolve(status),
    () => true,
    exit.promise,
    () => {
      throw new Error('CLEANUP_FAILED');
    },
  );
  await monitor.initialize();
  const done = monitor.start(() => deferred<'terminal' | 'aborted'>().promise);
  const failed = expect(done).rejects.toThrow('STATUS_UNCONFIRMED');
  status = [];
  await tick();
  await failed;
  expect(() => monitor.start(() => Promise.resolve('terminal'))).toThrow('STATUS_UNCONFIRMED');
});
it('closes native admission when the owner dispatches beyond captured capacity', async () => {
  const f = await fixture();
  const held = f.monitor.start(() => deferred<'terminal' | 'aborted'>().promise);
  const failed = expect(held).rejects.toThrow('STATUS_UNCONFIRMED');
  expect(() => f.monitor.start(() => Promise.resolve('terminal'))).toThrow('NO_NATIVE_CAPACITY');
  expect(f.cleanup()).toBe(1);
  expect(() => f.monitor.start(() => Promise.resolve('terminal'))).toThrow('STATUS_UNCONFIRMED');
  await failed;
});

it('keeps the five-second cancellation proof bound during a slow remote poll', async () => {
  const f = await fixture(1, 300_000);
  const stream = deferred<'terminal' | 'aborted'>();
  f.reader(() => new Promise(() => undefined));
  const done = f.monitor.start(() => stream.promise);
  await tick();
  stream.resolve('aborted');
  const failed = expect(done).rejects.toThrow('STATUS_UNCONFIRMED');
  await vi.advanceTimersByTimeAsync(5000);
  await failed;
  expect(f.cleanup()).toBe(1);
  expect(() => f.monitor.start(() => Promise.resolve('terminal'))).toThrow('STATUS_UNCONFIRMED');
});

it('allows a completed remote response to await delayed native disposal proof', async () => {
  const f = await fixture(1, 300_000);
  const stream = deferred<'terminal' | 'aborted'>();
  const status = deferred<readonly SlotStatus[]>();
  const done = f.monitor.start(() => stream.promise);
  f.status([{ id: 0, processing: true, task: 1 }]);
  await tick();
  f.reader(() => status.promise);
  stream.resolve('terminal');
  const result = done.catch((error: Error) => error.message);
  await tick();
  await vi.advanceTimersByTimeAsync(6000);
  expect(f.cleanup()).toBe(0);
  status.resolve([{ id: 0, processing: false, task: 1 }]);
  // An in-flight read begun before the terminal cannot prove disposal.
  await tick();
  expect(await result).toBe('released');
});
it('observes captured engine exit immediately while a remote status request is hung', async () => {
  const f = await fixture(1, 300_000);
  f.reader(() => new Promise(() => undefined));
  const done = f.monitor.start(() => deferred<'terminal' | 'aborted'>().promise);
  await tick();
  f.exit.resolve();
  await expect(done).resolves.toBe('engine-exited');
  expect(f.cleanup()).toBe(0);
});
