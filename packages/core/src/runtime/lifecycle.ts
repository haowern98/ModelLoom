import { decodeEvent } from './contracts.js';
import type { Event, Identity, RequestRecord, Selection, Snapshot } from './contracts.js';

/** Creates an immutable, empty deployment state after validating its opaque ID. */
export function initialSnapshot(deploymentId: string): Snapshot {
  decodeEvent(
    JSON.stringify({ type: 'ready', deploymentId, sessionId: 'initial', operationId: 'initial' }),
  );
  return freeze({ deploymentId, phase: 'stopped', selection: null, fault: null, requests: {} });
}

/** Applies a validated event without mutating prior snapshots; stale identities have no effect. */
export function transition(state: Snapshot, input: Event): Snapshot {
  const event = decodeEvent(JSON.stringify(input));
  if (event.type === 'start') {
    if (event.selection.deploymentId !== state.deploymentId) throw new Error('INVALID_TRANSITION');
    if (state.phase !== 'stopped' && state.phase !== 'failed') throw new Error('BUSY');
    return freeze({ ...state, phase: 'starting', selection: event.selection, fault: null });
  }
  if (state.selection === null) {
    if (event.type === 'request-started') throw new Error('NOT_READY');
    return state;
  }
  if (!matchesIdentity(state.selection, event)) return state;
  switch (event.type) {
    case 'spawned':
      requirePhase(state, ['starting']);
      return freeze({ ...state, phase: 'loading' });
    case 'ready':
      requirePhase(state, ['loading']);
      return freeze({ ...state, phase: 'ready' });
    case 'stopping':
      requirePhase(state, ['starting', 'loading', 'ready', 'failed']);
      return freeze({ ...state, phase: 'stopping', requests: interrupt(state.requests) });
    case 'stopped':
      if (state.phase === 'stopped') return state;
      requirePhase(state, ['stopping']);
      return freeze({ ...state, phase: 'stopped' });
    case 'failed':
      if (state.phase === 'failed') return state;
      requirePhase(state, ['starting', 'loading', 'ready', 'stopping']);
      return freeze({
        ...state,
        phase: 'failed',
        fault: event.fault,
        requests: interrupt(state.requests),
      });
    case 'request-started':
      if (state.phase !== 'ready') throw new Error('NOT_READY');
      if (Object.hasOwn(state.requests, event.requestId)) throw new Error('INVALID_TRANSITION');
      return withRecord(state, { requestId: event.requestId, text: '', status: 'running' });
    case 'text':
    case 'request-completed': {
      const record = state.requests[event.requestId];
      if (!record) throw new Error('INVALID_TRANSITION');
      if (record.status !== 'running') return state;
      if (state.phase !== 'ready') throw new Error('NOT_READY');
      return withRecord(
        state,
        event.type === 'text'
          ? { ...record, text: record.text + event.text }
          : { ...record, status: 'completed' },
      );
    }
  }
}

/** All three fields must match; a PID, package or session name alone cannot correlate a callback. */
export function matchesIdentity(selection: Selection, identity: Identity): boolean {
  return (
    selection.deploymentId === identity.deploymentId &&
    selection.sessionId === identity.sessionId &&
    selection.operationId === identity.operationId
  );
}
function requirePhase(state: Snapshot, phases: readonly Snapshot['phase'][]): void {
  if (!phases.includes(state.phase)) throw new Error('INVALID_TRANSITION');
}
function interrupt(records: Snapshot['requests']): Snapshot['requests'] {
  return Object.fromEntries(
    Object.entries(records).map(([id, record]) => [
      id,
      record.status === 'running' ? Object.freeze({ ...record, status: 'interrupted' }) : record,
    ]),
  );
}
function withRecord(state: Snapshot, record: RequestRecord): Snapshot {
  return freeze({
    ...state,
    requests: { ...state.requests, [record.requestId]: Object.freeze(record) },
  });
}
function freeze(state: Snapshot): Snapshot {
  return Object.freeze({ ...state, requests: Object.freeze(state.requests) });
}
