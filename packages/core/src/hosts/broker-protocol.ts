import type { Selection } from '../runtime/contracts.js';
import { decodeEvent } from '../runtime/contracts.js';
import { decodeObject, exact } from './control.js';

export type BrokerAction = 'launch' | 'stop' | 'force' | 'crash';
export type EnginePhase = 'captured' | 'ready' | 'exited' | 'failed';
export function selectionFrom(value: unknown): Selection {
  const event = decodeEvent(JSON.stringify({ type: 'start', selection: value }));
  if (
    event.type !== 'start' ||
    event.selection.deploymentId !== 'fixture-host' ||
    event.selection.packageId !== 'fixture' ||
    event.selection.modelId !== 'fixture'
  )
    throw new Error('INVALID_CONTROL');
  return event.selection;
}
/** Full selection identity is correlated for every utility-to-owner operation. */
export function decodeBroker(text: string): { action: BrokerAction; selection: Selection } {
  const value = decodeObject(text);
  exact(value, ['type', 'action', 'selection']);
  const action = value.action;
  if (
    value.type !== 'broker' ||
    (action !== 'launch' && action !== 'stop' && action !== 'force' && action !== 'crash')
  )
    throw new Error('INVALID_CONTROL');
  return { action, selection: selectionFrom(value.selection) };
}
export function decodeEngine(text: string): {
  phase: EnginePhase;
  selection: Selection;
  code: number;
} {
  const value = decodeObject(text);
  exact(value, ['type', 'phase', 'selection', 'code']);
  const phase = value.phase;
  const code = value.code;
  if (
    value.type !== 'engine' ||
    (phase !== 'captured' && phase !== 'ready' && phase !== 'exited' && phase !== 'failed') ||
    typeof code !== 'number' ||
    !Number.isInteger(code) ||
    code < 0 ||
    code > 4_294_967_295
  )
    throw new Error('INVALID_CONTROL');
  return { phase, selection: selectionFrom(value.selection), code };
}
export function selectionKey(selection: Selection): string {
  return JSON.stringify(selectionFrom(selection));
}

/** Validate every utility reply before forwarding data to the local fixture harness. */
export function decodeReply(input: unknown): Record<string, unknown> {
  const reply = decodeObject(JSON.stringify(input));
  if (typeof reply.id !== 'number' || !Number.isSafeInteger(reply.id) || reply.id < 0)
    throw new Error('INVALID_CONTROL');
  if (Object.hasOwn(reply, 'error')) {
    exact(reply, ['id', 'error']);
    if (
      typeof reply.error !== 'string' ||
      !['INVALID_CONTROL', 'INVALID_TRANSITION', 'NOT_READY', 'BUSY'].includes(reply.error)
    )
      throw new Error('INVALID_CONTROL');
    return reply;
  }
  exact(reply, ['id', 'snapshot']);
  const snapshot = decodeObject(JSON.stringify(reply.snapshot));
  exact(snapshot, ['deploymentId', 'phase', 'selection', 'fault', 'requests']);
  if (
    snapshot.deploymentId !== 'fixture-host' ||
    typeof snapshot.phase !== 'string' ||
    !['stopped', 'starting', 'loading', 'ready', 'stopping', 'failed'].includes(snapshot.phase)
  )
    throw new Error('INVALID_CONTROL');
  const selection = snapshot.selection === null ? null : selectionFrom(snapshot.selection);
  // Fault/request validation uses the existing core contract, including its identifier restrictions.
  const identity = selection ?? {
    deploymentId: 'fixture-host',
    sessionId: 'empty',
    operationId: 'empty',
  };
  const { deploymentId, sessionId, operationId } = identity;
  if (snapshot.fault !== null)
    decodeEvent(
      JSON.stringify({
        type: 'failed',
        deploymentId,
        sessionId,
        operationId,
        fault: snapshot.fault,
      }),
    );
  const requests = decodeObject(JSON.stringify(snapshot.requests));
  for (const [key, value] of Object.entries(requests)) {
    const record = decodeObject(JSON.stringify(value));
    exact(record, ['requestId', 'text', 'status']);
    if (
      key !== record.requestId ||
      typeof record.status !== 'string' ||
      !['running', 'completed', 'interrupted'].includes(record.status)
    )
      throw new Error('INVALID_CONTROL');
    decodeEvent(
      JSON.stringify({
        type: 'text',
        deploymentId,
        sessionId,
        operationId,
        requestId: record.requestId,
        text: record.text,
      }),
    );
  }
  return reply;
}
