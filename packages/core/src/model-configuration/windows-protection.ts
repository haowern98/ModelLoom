import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
export interface ApiKeyProtection {
  protect(key: Buffer): Buffer;
  unprotect(protectedKey: Buffer): Buffer;
}
/** Fixed DPAPI adapter. No shell, selectable key scope or plaintext persistence fallback. */
export function windowsApiKeyProtection(): ApiKeyProtection {
  try {
    if (process.platform !== 'win32') throw new Error('UNSUPPORTED_PLATFORM');
    const loaded: unknown = createRequire(import.meta.url)(
      fileURLToPath(new URL('../../out/native/history.node', import.meta.url)),
    );
    if (
      !loaded ||
      typeof loaded !== 'object' ||
      typeof Reflect.get(loaded, 'protectApiKey') !== 'function' ||
      typeof Reflect.get(loaded, 'unprotectApiKey') !== 'function'
    )
      throw new Error('INVALID_NATIVE_BINDING');
    const native = loaded as {
      protectApiKey(input: Buffer): Buffer;
      unprotectApiKey(input: Buffer): Buffer;
    };
    const invoke = (input: Buffer, protect: boolean): Buffer => {
      try {
        if (!Buffer.isBuffer(input) || !input.length || input.length > 4096)
          throw new Error('INVALID_CREDENTIAL');
        const result = protect ? native.protectApiKey(input) : native.unprotectApiKey(input);
        if (!Buffer.isBuffer(result) || !result.length || result.length > 4096)
          throw new Error('INVALID_CREDENTIAL');
        return result;
      } catch {
        throw new Error('CREDENTIAL_UNAVAILABLE');
      }
    };
    return Object.freeze({
      protect: (key: Buffer) => invoke(key, true),
      unprotect: (key: Buffer) => invoke(key, false),
    });
  } catch {
    throw new Error('CREDENTIAL_UNAVAILABLE');
  }
}
