import { createHash } from 'node:crypto';
import { lstat, open } from 'node:fs/promises';
export interface GGUFInfo {
  readonly sha256: string;
  readonly architecture: string;
  readonly contextLimit: number;
  readonly tensors: number;
}
/** Inspect GGUF v3 metadata within 16 MiB; this is not tensor validation or a memory planner. */
export async function inspectGGUF(file: string): Promise<GGUFInfo> {
  const invalid = (): never => {
    throw new Error('INVALID_GGUF');
  };
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink()) return invalid();
  const handle = await open(file, 'r');
  try {
    const buffer = Buffer.alloc(Math.min(stat.size, 16 * 1024 * 1024));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    let offset = 0,
      operations = 0;
    const take = (size: number) => {
      if (
        !Number.isSafeInteger(size) ||
        size < 0 ||
        offset + size > bytesRead ||
        ++operations > 65536
      )
        return invalid();
      const bytes = buffer.subarray(offset, offset + size);
      offset += size;
      return bytes;
    };
    const u32 = () => take(4).readUInt32LE();
    const u64 = () => {
      const n = take(8).readBigUInt64LE();
      return n <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(n) : invalid();
    };
    const string = () => {
      const size = u64();
      if (size > 65536) return invalid();
      return new TextDecoder('utf-8', { fatal: true }).decode(take(size));
    };
    const value = (type: number): unknown => {
      const sizes = [1, 1, 2, 2, 4, 4, 4, 1];
      if (type === 4) return u32();
      if (type === 8) return string();
      if (type === 10) return u64();
      if (type === 9) {
        const item = u32(),
          count = u64();
        if (item === 9 || count > 16384) return invalid();
        for (let i = 0; i < count; i++) value(item);
        return undefined;
      }
      const size = sizes[type] ?? (type === 11 || type === 12 ? 8 : 0);
      if (!size) return invalid();
      take(size);
      return undefined;
    };
    if (take(4).toString('ascii') !== 'GGUF' || u32() !== 3) return invalid();
    const tensors = u64(),
      count = u64();
    if (tensors < 1 || tensors > 1000000 || count < 1 || count > 4096) return invalid();
    const metadata = new Map<string, unknown>();
    for (let i = 0; i < count; i++) {
      const key = string();
      if (metadata.has(key) || key.length > 256) return invalid();
      metadata.set(key, value(u32()));
    }
    const architecture = metadata.get('general.architecture');
    if (typeof architecture !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/u.test(architecture))
      return invalid();
    const contextLimit = metadata.get(`${architecture}.context_length`);
    if (
      !Number.isSafeInteger(contextLimit) ||
      Number(contextLimit) < 1 ||
      Number(contextLimit) > 2147483647
    )
      return invalid();
    const hash = createHash('sha256');
    for await (const chunk of handle.createReadStream({ start: 0, autoClose: false })) {
      const bytes: unknown = chunk;
      if (!Buffer.isBuffer(bytes)) return invalid();
      hash.update(bytes);
    }
    const after = await handle.stat();
    if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ino !== stat.ino)
      return invalid();
    return Object.freeze({
      architecture,
      contextLimit: Number(contextLimit),
      tensors,
      sha256: hash.digest('hex'),
    });
  } catch {
    return invalid();
  } finally {
    await handle.close();
  }
}
