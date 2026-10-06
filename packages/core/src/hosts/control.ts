import type { Event, Selection } from '../runtime/contracts.js';
import { decodeEvent, MAX_CONTROL_BYTES } from '../runtime/contracts.js';

export type HostCommand = { readonly id: number } & (
  | { readonly action: 'load'; readonly selection: Selection }
  | { readonly action: 'record'; readonly event: Event }
  | { readonly action: 'stop' | 'snapshot' | 'quit' | 'crash' | 'crash-core' }
);
/** Closed development-fixture command schema. This is not a renderer or production IPC bridge. */
export function decodeCommand(text: string): HostCommand {
  try {
    const value = decodeObject(text);
    const id = value.id;
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1) throw new Error();
    const action = value.action;
    switch (action) {
      case 'load': {
        exact(value, ['id', 'action', 'selection']);
        const event = decodeEvent(JSON.stringify({ type: 'start', selection: value.selection }));
        if (event.type !== 'start') throw new Error();
        return Object.freeze({ id, action, selection: event.selection });
      }
      case 'record': {
        exact(value, ['id', 'action', 'event']);
        const event = decodeEvent(JSON.stringify(value.event));
        if (!['request-started', 'text', 'request-completed'].includes(event.type))
          throw new Error();
        return Object.freeze({ id, action, event });
      }
      case 'stop':
      case 'snapshot':
      case 'quit':
      case 'crash':
      case 'crash-core':
        exact(value, ['id', 'action']);
        return Object.freeze({ id, action });
      default:
        throw new Error();
    }
  } catch {
    throw new Error('INVALID_CONTROL');
  }
}
/** Bound bytes before parsing any inherited-channel JSON; returns ordinary copied data. */
export function decodeObject(text: string): Record<string, unknown> {
  if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_CONTROL_BYTES)
    throw new Error('INVALID_CONTROL');
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('INVALID_CONTROL');
  return Object.fromEntries(Object.entries(value));
}
export function exact(value: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key)))
    throw new Error('INVALID_CONTROL');
}
