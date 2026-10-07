import { describe, expect, it } from 'vitest';
import type { Event, Phase, Snapshot } from './contracts.js';
import { initialSnapshot, matchesIdentity, transition } from './lifecycle.js';
const id = { deploymentId: 'd1', sessionId: 's1', operationId: 'op1' };
const selection = { ...id, packageId: 'p1', modelId: 'm1' };
function stateAt(phase: Phase): Snapshot {
  let state = initialSnapshot('d1');
  if (phase === 'stopped') return state;
  state = transition(state, { type: 'start', selection });
  if (phase === 'starting') return state;
  state = transition(state, { type: 'spawned', ...id });
  if (phase === 'loading') return state;
  state = transition(state, { type: 'ready', ...id });
  if (phase === 'ready') return state;
  return phase === 'stopping'
    ? transition(state, { type: 'stopping', ...id })
    : transition(state, {
        type: 'failed',
        ...id,
        fault: { code: 'ENGINE_EXITED', message: 'Owned engine exited' },
      });
}
describe('lifecycle', () => {
  it('rejects request admission before any session exists', () => {
    expect(() =>
      transition(initialSnapshot('d1'), { type: 'request-started', ...id, requestId: 'r1' }),
    ).toThrow('NOT_READY');
  });
  it.each([
    ['stopped', 'start', 'starting'],
    ['failed', 'start', 'starting'],
    ['starting', 'spawned', 'loading'],
    ['loading', 'ready', 'ready'],
    ['starting', 'stopping', 'stopping'],
    ['loading', 'stopping', 'stopping'],
    ['ready', 'stopping', 'stopping'],
    ['failed', 'stopping', 'stopping'],
    ['stopping', 'stopped', 'stopped'],
    ['starting', 'failed', 'failed'],
    ['loading', 'failed', 'failed'],
    ['ready', 'failed', 'failed'],
    ['stopping', 'failed', 'failed'],
  ] as const)('%s + %s -> %s', (from, type, want) => {
    const event: Event =
      type === 'start'
        ? { type, selection: { ...selection, operationId: 'op2' } }
        : type === 'failed'
          ? { type, ...id, fault: { code: 'ENGINE_EXITED', message: 'Owned engine exited' } }
          : { type, ...id };
    expect(transition(stateAt(from), event).phase).toBe(want);
  });
  it.each(['starting', 'loading', 'ready', 'stopping'] as const)(
    'rejects overlapping start from %s',
    (phase) => {
      expect(() =>
        transition(stateAt(phase), {
          type: 'start',
          selection: { ...selection, operationId: 'op2' },
        }),
      ).toThrow('BUSY');
    },
  );
  it('rejects a start belonging to another deployment', () => {
    expect(() =>
      transition(initialSnapshot('d1'), {
        type: 'start',
        selection: { ...selection, deploymentId: 'd2' },
      }),
    ).toThrow('INVALID_TRANSITION');
  });
  it('rejects ready before spawn', () =>
    expect(() => transition(stateAt('starting'), { type: 'ready', ...id })).toThrow(
      'INVALID_TRANSITION',
    ));
  it.each(['deploymentId', 'sessionId', 'operationId'] as const)(
    'ignores stale %s callbacks',
    (field) => {
      const state = stateAt('ready');
      const old = { ...id, [field]: 'old' };
      expect(matchesIdentity(selection, old)).toBe(false);
      for (const event of [
        { type: 'ready', ...old },
        { type: 'failed', ...old, fault: { code: 'ENGINE_EXITED', message: 'old' } },
        { type: 'text', ...old, requestId: 'r1', text: 'late' },
      ] satisfies Event[])
        expect(transition(state, event)).toBe(state);
    },
  );
  it.each(['starting', 'loading', 'stopping', 'failed'] as const)(
    'closes request admission in %s',
    (phase) => {
      expect(() =>
        transition(stateAt(phase), { type: 'request-started', ...id, requestId: 'r1' }),
      ).toThrow('NOT_READY');
    },
  );
  it('preserves two partial records while leaving completed output intact', () => {
    let state = stateAt('ready');
    for (const requestId of ['r1', 'r2', 'r3']) {
      state = transition(state, { type: 'request-started', ...id, requestId });
      state = transition(state, {
        type: 'text',
        ...id,
        requestId,
        text: requestId === 'r3' ? 'done' : 'partial',
      });
    }
    state = transition(state, { type: 'request-completed', ...id, requestId: 'r3' });
    const previous = state;
    state = transition(state, {
      type: 'failed',
      ...id,
      fault: { code: 'ENGINE_EXITED', message: 'Owned engine exited' },
    });
    expect(state.requests).toEqual({
      r1: { requestId: 'r1', text: 'partial', status: 'interrupted' },
      r2: { requestId: 'r2', text: 'partial', status: 'interrupted' },
      r3: { requestId: 'r3', text: 'done', status: 'completed' },
    });
    expect(previous.requests.r1?.status).toBe('running');
    expect(transition(state, { type: 'text', ...id, requestId: 'r1', text: 'late' })).toBe(state);
    expect(transition(state, { type: 'request-completed', ...id, requestId: 'r1' })).toBe(state);
    expect(
      transition(state, {
        type: 'failed',
        ...id,
        fault: { code: 'START_FAILED', message: 'late' },
      }),
    ).toBe(state);
    const retried = transition(state, {
      type: 'start',
      selection: { ...selection, operationId: 'op2' },
    });
    expect(retried.fault).toBeNull();
    expect(retried.requests).toEqual(state.requests);
  });
  it('interrupts admission and output when stop begins', () => {
    let state = transition(stateAt('ready'), { type: 'request-started', ...id, requestId: 'r1' });
    state = transition(state, { type: 'stopping', ...id });
    expect(state.requests.r1?.status).toBe('interrupted');
    state = transition(state, { type: 'stopped', ...id });
    expect(transition(state, { type: 'stopped', ...id })).toBe(state);
  });
  it('rejects request reuse and ignores duplicate completion', () => {
    let state = transition(stateAt('ready'), { type: 'request-started', ...id, requestId: 'r1' });
    expect(() => transition(state, { type: 'request-started', ...id, requestId: 'r1' })).toThrow(
      'INVALID_TRANSITION',
    );
    state = transition(state, { type: 'request-completed', ...id, requestId: 'r1' });
    expect(transition(state, { type: 'request-completed', ...id, requestId: 'r1' })).toBe(state);
  });
  it('rejects text without an admitted request', () =>
    expect(() =>
      transition(stateAt('ready'), { type: 'text', ...id, requestId: 'missing', text: 'bad' }),
    ).toThrow('INVALID_TRANSITION'));
  it('protects published snapshots and earlier text from mutation', () => {
    const started = transition(stateAt('ready'), {
      type: 'request-started',
      ...id,
      requestId: 'r1',
    });
    const appended = transition(started, { type: 'text', ...id, requestId: 'r1', text: 'new' });
    expect(started.requests.r1?.text).toBe('');
    expect(() => Object.assign(appended.requests.r1 ?? {}, { text: 'changed' })).toThrow();
    expect(() => Object.assign(appended, { phase: 'ready' })).toThrow();
  });
});
