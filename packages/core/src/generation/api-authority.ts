import { randomUUID } from 'node:crypto';
declare const callerBrand: unique symbol;
/** Opaque, non-serializable authority issued only after local listener authentication. */
export interface ApiCaller {
  readonly [callerBrand]: true;
}
const callers = new WeakMap<ApiCaller, { readonly scope: ApiCallerScope; readonly id: string }>();
/** One authenticated listener/key generation. Closing it revokes every issued caller. */
export class ApiCallerScope {
  private closed = false;
  issue(): ApiCaller {
    if (this.closed) throw new Error('DENIED');
    const caller = Object.freeze({}) as ApiCaller;
    callers.set(caller, { scope: this, id: `api-${randomUUID()}` });
    return caller;
  }
  close(): void {
    this.closed = true;
  }
  get active(): boolean {
    return !this.closed;
  }
}
/** Data that looks like a caller cannot recover WeakMap membership or revive a closed scope. */
export function requireApiCaller(caller: ApiCaller): string {
  const entry = callers.get(caller);
  if (!entry || !entry.scope.active) throw new Error('DENIED');
  return entry.id;
}
