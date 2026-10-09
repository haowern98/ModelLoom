import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/** In-process authority created from main's application-data location, never IPC. */
export interface TrustedHistoryRoot {
  readonly applicationData: string;
}
export interface HistoryDirectoryGuard {
  readonly database: string;
  readonly journal: string;
  reserveJournal(): void;
  close(): void;
}
const trusted = new WeakSet<TrustedHistoryRoot>();
interface Binding {
  open(root: string): object;
  reserve(guard: object): void;
  close(guard: object): void;
}
/** Trusted host factory. Serialized objects cannot acquire this capability. */
export function trustedHistoryRoot(applicationData: string): TrustedHistoryRoot {
  if (
    process.platform !== 'win32' ||
    !/^[A-Za-z]:\\/u.test(applicationData) ||
    applicationData.length > 32000 ||
    applicationData.includes('\0') ||
    applicationData.includes('/') ||
    applicationData.includes(':', 2) ||
    applicationData
      .split('\\')
      .slice(1)
      .some((part) => !part || /[. ]$/u.test(part))
  )
    throw new Error('INVALID_HISTORY_ROOT');
  const result = Object.freeze({ applicationData });
  trusted.add(result);
  return result;
}
/** Hold native identities throughout SQLite's lifetime; fail closed without a path-only fallback. */
export function openHistoryDirectory(root: TrustedHistoryRoot): HistoryDirectoryGuard {
  if (!trusted.has(root)) throw new Error('INVALID_HISTORY_ROOT');
  try {
    const loaded: unknown = createRequire(import.meta.url)(
      fileURLToPath(new URL('../../out/native/history.node', import.meta.url)),
    );
    if (
      !loaded ||
      typeof loaded !== 'object' ||
      !['open', 'reserve', 'close'].every((key) => typeof Reflect.get(loaded, key) === 'function')
    )
      throw new Error('INVALID_NATIVE_BINDING');
    // Fixed private module's complete operation table was checked above.
    const native = loaded as Binding,
      captured = native.open(root.applicationData);
    let closed = false;
    return Object.freeze({
      database: path.join(root.applicationData, 'chat/history.sqlite'),
      journal: path.join(root.applicationData, 'chat/history.sqlite-journal'),
      reserveJournal() {
        if (closed) throw new Error('HISTORY_UNAVAILABLE');
        native.reserve(captured);
      },
      close() {
        if (!closed) {
          native.close(captured);
          closed = true;
        }
      },
    });
  } catch {
    throw new Error('HISTORY_UNAVAILABLE');
  }
}
