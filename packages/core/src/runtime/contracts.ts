export const MAX_CONTROL_BYTES = 1024 * 1024;
export const LIFECYCLE_POLICY = Object.freeze({
  startupMs: 180_000,
  gracefulStopMs: 5_000,
  forcedExitMs: 2_000,
});
export type Phase = 'stopped' | 'starting' | 'loading' | 'ready' | 'stopping' | 'failed';
export type FaultCode =
  | 'INVALID_CONTROL'
  | 'INVALID_TRANSITION'
  | 'NOT_READY'
  | 'BUSY'
  | 'START_FAILED'
  | 'START_TIMEOUT'
  | 'ENGINE_EXITED'
  | 'CLEANUP_FAILED';
/** Correlates callbacks to one deployment and load attempt; IDs are bounded opaque identifiers. */
export interface Identity {
  readonly deploymentId: string;
  readonly sessionId: string;
  readonly operationId: string;
}
export interface Selection extends Identity {
  readonly packageId: string;
  readonly modelId: string;
}
export interface Fault {
  readonly code: FaultCode;
  readonly message: string;
}
export interface RequestRecord {
  readonly requestId: string;
  readonly text: string;
  readonly status: 'running' | 'completed' | 'interrupted';
}
/** In-memory state only. Interrupted records survive reload, not the core process's lifetime. */
export interface Snapshot {
  readonly deploymentId: string;
  readonly phase: Phase;
  readonly selection: Selection | null;
  readonly fault: Fault | null;
  readonly requests: Readonly<Record<string, RequestRecord>>;
}
export type Event =
  | { readonly type: 'start'; readonly selection: Selection }
  | ({ readonly type: 'spawned' | 'ready' | 'stopping' | 'stopped' } & Identity)
  | ({ readonly type: 'failed'; readonly fault: Fault } & Identity)
  | ({ readonly type: 'request-started'; readonly requestId: string } & Identity)
  | ({ readonly type: 'text'; readonly requestId: string; readonly text: string } & Identity)
  | ({ readonly type: 'request-completed'; readonly requestId: string } & Identity);
/**
 * Validates and copies a private control event; checks UTF-8 bytes before parsing.
 * @throws Error with INVALID_CONTROL, without disclosing rejected input.
 * @remarks This is an in-process contract, not authorization or a public IPC protocol.
 */
export function decodeEvent(text: string): Event {
  try {
    if (Buffer.byteLength(text, 'utf8') > MAX_CONTROL_BYTES) throw new Error('INVALID_CONTROL');
    const value: unknown = JSON.parse(text);
    return Object.freeze(validateEvent(value));
  } catch {
    throw new Error('INVALID_CONTROL');
  }
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('INVALID_CONTROL');
  // JSON parsing produces ordinary data objects; no unchecked cast to the event contract.
  return Object.fromEntries(Object.entries(value));
}
function fields(value: Record<string, unknown>, names: readonly string[]): void {
  if (
    Object.keys(value).length !== names.length ||
    names.some((name) => !Object.hasOwn(value, name))
  )
    throw new Error('INVALID_CONTROL');
}
function string(value: unknown): string {
  if (typeof value !== 'string') throw new Error('INVALID_CONTROL');
  return value;
}
function identifier(value: unknown): string {
  const id = string(value);
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id) ||
    ['__proto__', 'prototype', 'constructor'].includes(id)
  )
    throw new Error('INVALID_CONTROL');
  return id;
}
const identityFields = ['deploymentId', 'sessionId', 'operationId'];
function identity(value: Record<string, unknown>): Identity {
  return {
    deploymentId: identifier(value.deploymentId),
    sessionId: identifier(value.sessionId),
    operationId: identifier(value.operationId),
  };
}
function faultCode(value: unknown): FaultCode {
  switch (value) {
    case 'INVALID_CONTROL':
    case 'INVALID_TRANSITION':
    case 'NOT_READY':
    case 'BUSY':
    case 'START_FAILED':
    case 'START_TIMEOUT':
    case 'ENGINE_EXITED':
    case 'CLEANUP_FAILED':
      return value;
    default:
      throw new Error('INVALID_CONTROL');
  }
}
function validateEvent(input: unknown): Event {
  const value = object(input);
  switch (value.type) {
    case 'start': {
      fields(value, ['type', 'selection']);
      const selection = object(value.selection);
      fields(selection, [...identityFields, 'packageId', 'modelId']);
      return {
        type: 'start',
        selection: Object.freeze({
          ...identity(selection),
          packageId: identifier(selection.packageId),
          modelId: identifier(selection.modelId),
        }),
      };
    }
    case 'spawned':
    case 'ready':
    case 'stopping':
    case 'stopped':
      fields(value, ['type', ...identityFields]);
      return { type: value.type, ...identity(value) };
    case 'failed': {
      fields(value, ['type', ...identityFields, 'fault']);
      const fault = object(value.fault);
      fields(fault, ['code', 'message']);
      return {
        type: 'failed',
        ...identity(value),
        fault: Object.freeze({ code: faultCode(fault.code), message: string(fault.message) }),
      };
    }
    case 'request-started':
    case 'request-completed':
      fields(value, ['type', ...identityFields, 'requestId']);
      return { type: value.type, ...identity(value), requestId: identifier(value.requestId) };
    case 'text':
      fields(value, ['type', ...identityFields, 'requestId', 'text']);
      return {
        type: 'text',
        ...identity(value),
        requestId: identifier(value.requestId),
        text: string(value.text),
      };
    default:
      throw new Error('INVALID_CONTROL');
  }
}
