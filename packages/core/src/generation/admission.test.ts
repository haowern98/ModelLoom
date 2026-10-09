import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GenerationAdmission } from './admission.js';
import { GENERATION_POLICY } from './contracts.js';
import type { RequestIdentity, TerminalOutcome } from './contracts.js';

const session = { deploymentId: 'desktop', sessionId: 'session', operationId: 'load' };
const completed = { status: 'completed', reason: 'STOP' } as const;
function request(n: number, conversationId = `conversation-${n}`): RequestIdentity {
  return {
    ...session,
    requestId: `request-${n}`,
    callerId: 'caller',
    conversationId,
    attemptId: `attempt-${n}`,
  };
}
function fixture() {
  const started: string[] = [];
  const cancellations: string[] = [];
  const work = new Map<
    string,
    {
      resolve: (outcome: TerminalOutcome) => void;
      reject: (error: Error) => void;
    }
  >();
  const executor = {
    start(identity: RequestIdentity) {
      started.push(identity.requestId);
      const settled = new Promise<TerminalOutcome>((resolve, reject) => {
        work.set(identity.requestId, { resolve, reject });
      });
      return {
        settled,
        cancel() {
          cancellations.push(identity.requestId);
        },
      };
    },
  };
  const admission = new GenerationAdmission(session, executor);
  return { admission, executor, started, cancellations, work };
}
// This helper also verifies that rejected submissions never manufacture a completion promise.
function accepted(value: unknown): { done: Promise<TerminalOutcome> } {
  if (
    !value ||
    typeof value !== 'object' ||
    !('accepted' in value) ||
    value.accepted !== true ||
    !('done' in value) ||
    !(value.done instanceof Promise)
  )
    throw new Error('Expected admission');
  return { done: value.done as Promise<TerminalOutcome> };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('bounded core generation admission', () => {
  it('starts four, queues eight and rejects the thirteenth', () => {
    const f = fixture();
    for (let n = 0; n < 12; n++) accepted(f.admission.submit(request(n)));
    expect(f.started).toEqual(['request-0', 'request-1', 'request-2', 'request-3']);
    expect(f.admission.submit(request(12))).toEqual({ accepted: false, code: 'QUEUE_FULL' });
    expect(f.admission.snapshot()).toHaveLength(12);
  });
  it('starts only the oldest pending request when captured work settles', async () => {
    const f = fixture();
    for (let n = 0; n < 7; n++) accepted(f.admission.submit(request(n)));
    f.work.get('request-2')!.resolve(completed);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.started).toEqual(['request-0', 'request-1', 'request-2', 'request-3', 'request-4']);
    expect(f.admission.snapshot()).toHaveLength(6);
  });
  it('rejects duplicate outstanding IDs, busy conversations and wrong sessions', () => {
    const f = fixture();
    accepted(f.admission.submit(request(1)));
    expect(f.admission.submit(request(1))).toEqual({ accepted: false, code: 'INVALID_CONTROL' });
    expect(f.admission.submit(request(2, 'conversation-1'))).toEqual({
      accepted: false,
      code: 'CONVERSATION_BUSY',
    });
    expect(f.admission.submit({ ...request(3), sessionId: 'old' })).toEqual({
      accepted: false,
      code: 'NOT_READY',
    });
    expect(f.started).toHaveLength(1);
  });
  it('denies another caller and cancels queued work without starting it', async () => {
    const f = fixture();
    for (let n = 0; n < 4; n++) accepted(f.admission.submit(request(n)));
    const queued = accepted(f.admission.submit(request(4)));
    expect(f.admission.cancel('other', 'request-4')).toBe('denied');
    expect(f.admission.cancel('caller', 'request-4')).toBe('requested');
    expect(await queued.done).toEqual({ status: 'cancelled', reason: 'USER_CANCELLED' });
    expect(f.started).toHaveLength(4);
    expect(f.cancellations).toEqual([]);
  });
  it('holds active capacity until native settlement despite a successful cancel call', async () => {
    const f = fixture();
    const active = accepted(f.admission.submit(request(0)));
    for (let n = 1; n < 5; n++) accepted(f.admission.submit(request(n)));
    expect(f.admission.cancel('other', 'request-0')).toBe('denied');
    expect(f.admission.cancel('caller', 'request-0')).toBe('requested');
    expect(f.admission.cancel('caller', 'request-0')).toBe('requested');
    await vi.advanceTimersByTimeAsync(0);
    expect(f.started).toHaveLength(4);
    expect(f.cancellations).toEqual(['request-0']);
    f.work.get('request-0')!.resolve(completed);
    await vi.advanceTimersByTimeAsync(0);
    expect(await active.done).toEqual({ status: 'cancelled', reason: 'USER_CANCELLED' });
    expect(f.started.at(-1)).toBe('request-4');
  });
  it('preserves completion if its receipt wins the cancellation race', async () => {
    const f = fixture();
    const active = accepted(f.admission.submit(request(0)));
    f.work.get('request-0')!.resolve(completed);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.admission.cancel('caller', 'request-0')).toBe('already-terminal');
    expect(await active.done).toEqual(completed);
    expect(f.cancellations).toHaveLength(0);
  });
  it('expires pending work at 120 seconds without native submission', async () => {
    const f = fixture();
    for (let n = 0; n < 4; n++) accepted(f.admission.submit(request(n)));
    const queued = accepted(f.admission.submit(request(4)));
    await vi.advanceTimersByTimeAsync(GENERATION_POLICY.queueMs);
    expect(await queued.done).toEqual({ status: 'failed', reason: 'QUEUE_TIMEOUT' });
    expect(f.started).toHaveLength(4);
  });
  it('cancels timed-out active work and waits for settlement', async () => {
    const f = fixture();
    const active = accepted(f.admission.submit(request(0)));
    await vi.advanceTimersByTimeAsync(GENERATION_POLICY.generationMs);
    expect(f.cancellations).toEqual(['request-0']);
    expect(f.admission.snapshot()).toHaveLength(1);
    f.work.get('request-0')!.resolve(completed);
    await vi.advanceTimersByTimeAsync(0);
    expect(await active.done).toEqual({ status: 'failed', reason: 'GENERATION_TIMEOUT' });
  });
  it('fails closed after unconfirmed cancellation, including queued work', async () => {
    const f = fixture();
    const active = accepted(f.admission.submit(request(0)));
    for (let n = 1; n < 4; n++) accepted(f.admission.submit(request(n)));
    const queued = accepted(f.admission.submit(request(4)));
    f.admission.cancel('caller', 'request-0');
    await vi.advanceTimersByTimeAsync(GENERATION_POLICY.cancellationMs);
    expect(await active.done).toEqual({ status: 'failed', reason: 'CANCEL_UNCONFIRMED' });
    expect(await queued.done).toEqual({ status: 'interrupted', reason: 'ENGINE_EXITED' });
    expect(f.admission.submit(request(5))).toEqual({ accepted: false, code: 'NOT_READY' });
    expect(f.started).toHaveLength(4);
    f.work.get('request-0')!.resolve(completed);
    await vi.advanceTimersByTimeAsync(0);
    expect(await active.done).toEqual({ status: 'failed', reason: 'CANCEL_UNCONFIRMED' });
  });
  it('closes once, interrupts work and never starts an old queue after late receipts', async () => {
    const f = fixture();
    const active = accepted(f.admission.submit(request(0)));
    for (let n = 1; n < 4; n++) accepted(f.admission.submit(request(n)));
    const queued = accepted(f.admission.submit(request(4)));
    f.admission.close('SESSION_STOPPED');
    f.admission.close('SESSION_STOPPED');
    expect(await queued.done).toEqual({ status: 'interrupted', reason: 'SESSION_STOPPED' });
    expect(f.cancellations).toHaveLength(4);
    f.work.get('request-0')!.resolve(completed);
    await vi.advanceTimersByTimeAsync(0);
    expect(await active.done).toEqual({ status: 'interrupted', reason: 'SESSION_STOPPED' });
    expect(f.started).toHaveLength(4);
    expect(f.admission.submit(request(5))).toEqual({ accepted: false, code: 'NOT_READY' });
  });
  it('does not let rejected settlement release a possibly running native reservation', async () => {
    const f = fixture();
    const active = accepted(f.admission.submit(request(0)));
    f.work.get('request-0')!.reject(new Error('credential-bearing native failure'));
    await vi.advanceTimersByTimeAsync(0);
    expect(await active.done).toEqual({ status: 'failed', reason: 'EXECUTION_FAILED' });
    expect(f.admission.snapshot()).toHaveLength(1);
    expect(f.admission.submit(request(1))).toEqual({ accepted: false, code: 'NOT_READY' });
  });
  it('copies identities and returns immutable bounded snapshots', () => {
    const f = fixture();
    const identity = { ...request(0) };
    accepted(f.admission.submit(identity));
    identity.callerId = 'other';
    expect(f.admission.cancel('other', 'request-0')).toBe('denied');
    expect(Object.isFrozen(f.admission.snapshot())).toBe(true);
  });
  it('captures policy rather than allowing later mutation to extend capacity or deadlines', () => {
    const f = fixture();
    const policy = { ...GENERATION_POLICY };
    const admission = new GenerationAdmission(session, f.executor, policy);
    Reflect.set(policy, 'activeLimit', 100);
    Reflect.set(policy, 'pendingLimit', 100);
    for (let n = 0; n < 12; n++) accepted(admission.submit(request(n)));
    expect(f.started).toHaveLength(4);
    expect(admission.submit(request(12))).toEqual({ accepted: false, code: 'QUEUE_FULL' });
  });
  it('treats malformed settlement as unconfirmed even after cancellation was requested', async () => {
    const f = fixture();
    const active = accepted(f.admission.submit(request(0)));
    f.admission.cancel('caller', 'request-0');
    const invalid = { ...completed };
    Reflect.set(invalid, 'reason', 'arbitrary private error');
    f.work.get('request-0')!.resolve(invalid);
    await vi.advanceTimersByTimeAsync(0);
    expect(await active.done).toEqual({ status: 'failed', reason: 'EXECUTION_FAILED' });
    expect(f.admission.snapshot()).toHaveLength(1);
    expect(f.admission.requiresCleanup).toBe(true);
  });
});
