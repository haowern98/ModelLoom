import { lstat, mkdir, open, readFile, realpath, rename, unlink } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export interface NetworkProtection {
  available(): boolean;
  encrypt(text: string): Buffer;
  decrypt(bytes: Buffer): string;
}
export interface NetworkStore {
  read(key: string): Promise<Buffer | undefined>;
  write(key: string, value: Buffer | undefined): Promise<void>;
  clear(): Promise<void>;
  close(): Promise<void>;
}
/** Ciphertext I/O is owned by the helper that holds the cross-process OS lease. */
export interface NetworkCiphertext {
  read(): Promise<Buffer | undefined>;
  replace(bytes: Buffer): Promise<void>;
}
const maximum = 4 * 1024 * 1024;
const owners = new Set<string>();
function unavailable(): never {
  throw Error('NETWORK_STORAGE_UNAVAILABLE');
}
function missing(error: unknown): boolean {
  return !!error && typeof error === 'object' && Reflect.get(error, 'code') === 'ENOENT';
}
function stateKey(key: string): void {
  if (
    !key.length ||
    key.length > 256 ||
    [...key].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
  )
    unavailable();
}

/** Ciphertext-only atomic storage. The helper's OS-released file lock excludes
 * other processes before StateStore access; this lease excludes duplicate local brokers. */
export async function openNetworkStore(
  directory: string,
  protection: NetworkProtection,
  makePrivate?: (directory: string) => void,
  ciphertext?: NetworkCiphertext,
): Promise<NetworkStore> {
  const requested = path.resolve(directory);
  let root = requested;
  let leased = false;
  try {
    if (!protection.available()) unavailable();
    await mkdir(requested, { recursive: true, mode: 0o700 });
    if (!(await lstat(requested)).isDirectory() || (await lstat(requested)).isSymbolicLink())
      unavailable();
    root = await realpath(requested);
    const file = path.join(root, 'enrollment.bin');
    makePrivate?.(root);
    if (owners.has(root)) throw Error('NETWORK_STORAGE_BUSY');
    owners.add(root);
    leased = true;
    const domain = `ModelLoom.Tailscale.v1:${createHash('sha256').update(root).digest('hex')}`;
    let values: Record<string, string> = Object.create(null) as Record<string, string>;
    try {
      let bytes: Buffer | undefined;
      if (ciphertext) bytes = await ciphertext.read();
      else {
        const stat = await lstat(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximum * 2) unavailable();
        bytes = await readFile(file);
      }
      if (bytes === undefined) {
        const absent = Error('missing');
        Object.assign(absent, { code: 'ENOENT' });
        throw absent;
      }
      if (bytes.length > maximum * 2) unavailable();
      const plaintext = protection.decrypt(bytes);
      if (Buffer.byteLength(plaintext) > maximum) unavailable();
      const decoded: unknown = JSON.parse(plaintext);
      if (!decoded || typeof decoded !== 'object' || Reflect.get(decoded, 'domain') !== domain)
        unavailable();
      const entries: unknown = Reflect.get(decoded, 'values');
      if (!entries || typeof entries !== 'object' || Array.isArray(entries)) unavailable();
      for (const [key, data] of Object.entries(entries)) {
        stateKey(key);
        if (typeof data !== 'string' || Buffer.from(data, 'base64').toString('base64') !== data)
          unavailable();
        values[key] = data;
      }
    } catch (error) {
      if (!missing(error)) throw error;
    }
    let closed = false,
      pending = Promise.resolve();
    const check = () => {
      if (closed || !protection.available()) unavailable();
    };
    const persist = async (next: Record<string, string>) => {
      check();
      const plain = JSON.stringify({ domain, values: next });
      if (Buffer.byteLength(plain) > maximum) unavailable();
      const encrypted = protection.encrypt(plain);
      if (!encrypted.length || encrypted.length > maximum * 2) unavailable();
      if (ciphertext) {
        await ciphertext.replace(encrypted);
        values = next;
        return;
      }
      const temporary = path.join(root, `${randomUUID()}.new`);
      let output: FileHandle | undefined;
      try {
        output = await open(temporary, 'wx', 0o600);
        await output.writeFile(encrypted);
        await output.sync();
        await output.close();
        output = undefined;
        await rename(temporary, file);
        values = next;
      } finally {
        await output?.close();
        await unlink(temporary).catch(() => undefined);
      }
    };
    return {
      async read(key) {
        check();
        stateKey(key);
        await pending;
        return Object.hasOwn(values, key) ? Buffer.from(values[key]!, 'base64') : undefined;
      },
      write(key, value) {
        stateKey(key);
        if (value && value.length > maximum)
          return Promise.reject(Error('NETWORK_STORAGE_UNAVAILABLE'));
        const copied = value ? Buffer.from(value) : undefined;
        const operation = pending
          .then(async () => {
            check();
            const next = { ...values };
            if (copied === undefined) delete next[key];
            else next[key] = copied.toString('base64');
            await persist(next);
          })
          .finally(() => copied?.fill(0))
          .catch(() => unavailable());
        pending = operation.catch(() => undefined);
        return operation;
      },
      clear() {
        const operation = pending
          .then(() => persist(Object.create(null) as Record<string, string>))
          .catch(() => unavailable());
        pending = operation.catch(() => undefined);
        return operation;
      },
      async close() {
        if (closed) return;
        closed = true;
        await pending;
        owners.delete(root);
        leased = false;
        values = Object.create(null) as Record<string, string>;
      },
    };
  } catch (error) {
    if (leased) owners.delete(root);
    if (error instanceof Error && error.message === 'NETWORK_STORAGE_BUSY') throw error;
    return unavailable();
  }
}
