import type { Selection } from '../runtime/contracts.js';
import { decodeEvent } from '../runtime/contracts.js';
import { decodeObject, exact } from './control.js';

export type BrokerAction = 'launch' | 'stop' | 'force' | 'crash';
export type EnginePhase = 'captured' | 'ready' | 'exited' | 'failed';
/** Main-captured scope. This is sent over the inherited utility channel, never renderer IPC. */
export interface BrokerScope {
  deploymentId: string;
  packageId: string;
  modelId: string;
}
export const FIXTURE_SCOPE: BrokerScope = Object.freeze({
  deploymentId: 'fixture-host',
  packageId: 'fixture',
  modelId: 'fixture',
});
export function selectionFrom(value: unknown, scope: BrokerScope = FIXTURE_SCOPE): Selection {
  const event = decodeEvent(JSON.stringify({ type: 'start', selection: value }));
  if (
    event.type !== 'start' ||
    event.selection.deploymentId !== scope.deploymentId ||
    event.selection.packageId !== scope.packageId ||
    event.selection.modelId !== scope.modelId
  )
    throw new Error('INVALID_CONTROL');
  return event.selection;
}
/** Full selection identity is correlated for every utility-to-owner operation. */
export function decodeBroker(
  text: string,
  scope: BrokerScope = FIXTURE_SCOPE,
): { action: BrokerAction; selection: Selection } {
  const value = decodeObject(text);
  exact(value, ['type', 'action', 'selection']);
  const action = value.action;
  if (
    value.type !== 'broker' ||
    (action !== 'launch' && action !== 'stop' && action !== 'force' && action !== 'crash')
  )
    throw new Error('INVALID_CONTROL');
  return { action, selection: selectionFrom(value.selection, scope) };
}
export function decodeEngine(
  text: string,
  scope: BrokerScope = FIXTURE_SCOPE,
): {
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
  return { phase, selection: selectionFrom(value.selection, scope), code };
}
export function selectionKey(selection: Selection): string {
  const event = decodeEvent(JSON.stringify({ type: 'start', selection }));
  if (event.type !== 'start') throw new Error('INVALID_CONTROL');
  return JSON.stringify(event.selection);
}

/** Validate every utility reply before forwarding data to the local fixture harness. */
export function decodeReply(
  input: unknown,
  scope: BrokerScope = FIXTURE_SCOPE,
): Record<string, unknown> {
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
    snapshot.deploymentId !== scope.deploymentId ||
    typeof snapshot.phase !== 'string' ||
    !['stopped', 'starting', 'loading', 'ready', 'stopping', 'failed'].includes(snapshot.phase)
  )
    throw new Error('INVALID_CONTROL');
  const selection = snapshot.selection === null ? null : selectionFrom(snapshot.selection, scope);
  // Fault/request validation uses the existing core contract, including its identifier restrictions.
  const identity = selection ?? {
    deploymentId: scope.deploymentId,
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
