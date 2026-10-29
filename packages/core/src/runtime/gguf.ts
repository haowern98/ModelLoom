import { createHash } from 'node:crypto';
import { lstat, open } from 'node:fs/promises';
import path from 'node:path';
import type { SpeculativeHeadKind } from '../model-configuration/model-source.js';
import { classifySpeculativeGGUF } from './gguf-speculation.js';
export interface GGUFInfo {
  readonly sha256: string;
  readonly architecture: string;
  readonly contextLimit: number;
  readonly tensors: number;
  /** Indexed repeating-block metadata only; executable profile support is checked separately. */
  readonly blockCount: number | null;
  /** Extra NextN blocks are allocated but not executed in ordinary decoder inference. */
  readonly nextnPredictLayers?: number;
  /** Template capability hint only; the template itself is never exposed. */
  readonly thinkingSupported?: boolean;
  readonly speculativeHead?: SpeculativeHeadKind;
  readonly name?: string;
  readonly quantization?: string;
  readonly parameters?: string;
}
// llama_ftype IDs from the pinned llama.cpp 4f31296 include/llama.h; unknown IDs stay unknown.
const fileTypes: Readonly<Record<number, string>> = {
  0: 'F32',
  1: 'F16',
  2: 'Q4_0',
  3: 'Q4_1',
  7: 'Q8_0',
  8: 'Q5_0',
  9: 'Q5_1',
  10: 'Q2_K',
  11: 'Q3_K_S',
  12: 'Q3_K_M',
  13: 'Q3_K_L',
  14: 'Q4_K_S',
  15: 'Q4_K_M',
  16: 'Q5_K_S',
  17: 'Q5_K_M',
  18: 'Q6_K',
  19: 'IQ2_XXS',
  20: 'IQ2_XS',
  21: 'Q2_K_S',
  22: 'IQ3_XS',
  23: 'IQ3_XXS',
  24: 'IQ1_S',
  25: 'IQ4_NL',
  26: 'IQ3_S',
  27: 'IQ3_M',
  28: 'IQ2_S',
  29: 'IQ2_M',
  30: 'IQ4_XS',
  31: 'IQ1_M',
  32: 'BF16',
  36: 'TQ1_0',
  37: 'TQ2_0',
  38: 'MXFP4_MOE',
  39: 'NVFP4',
  40: 'Q1_0',
  41: 'Q2_0',
};
/** Inspect headers without hashing payloads; callers must retain ownership and reconcile file identity. */
export async function inspectGGUFHeader(file: string): Promise<Omit<GGUFInfo, 'sha256'>> {
  return inspect(file, false);
}
/** Bounded metadata and tensor-directory inspection, plus complete file hashing for new imports. */
export function inspectGGUF(file: string): Promise<GGUFInfo> {
  return inspect(file, true);
}
function inspect(file: string, hashPayload: true): Promise<GGUFInfo>;
function inspect(file: string, hashPayload: false): Promise<Omit<GGUFInfo, 'sha256'>>;
async function inspect(
  file: string,
  hashPayload: boolean,
): Promise<Omit<GGUFInfo, 'sha256'> & { sha256?: string }> {
  const invalid = (): never => {
    throw new Error('INVALID_GGUF');
  };
  if (path.extname(file).toLowerCase() !== '.gguf') return invalid();
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
        ++operations > 4_000_000
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
    const value = (type: number, retainArray = false): unknown => {
      const sizes = [1, 1, 2, 2, 4, 4, 4, 1];
      if (type === 4) return u32();
      if (type === 5) return take(4).readInt32LE();
      if (type === 7) {
        const byte = take(1)[0];
        if (byte !== 0 && byte !== 1) return invalid();
        return byte === 1;
      }
      if (type === 8) return string();
      if (type === 10) return u64();
      if (type === 9) {
        const item = u32(),
          count = u64();
        // Modern tokenizers routinely exceed 16K entries. The byte budget still
        // bounds every value; the operation cap also bounds many tiny strings.
        if (item === 9 || count > 1_000_000) return invalid();
        if (retainArray && count > 4096) return invalid();
        const items: unknown[] = [];
        for (let i = 0; i < count; i++) {
          const entry = value(item);
          if (retainArray) items.push(entry);
        }
        return retainArray ? items : undefined;
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
      metadata.set(key, value(u32(), key.endsWith('.target_layers')));
    }
    const architecture = metadata.get('general.architecture');
    if (typeof architecture !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/u.test(architecture))
      return invalid();
    if (metadata.get('general.type') === 'adapter') return invalid();
    const directory = new Map<string, readonly number[]>();
    for (let index = 0; index < tensors; index++) {
      const name = string();
      if (!name || name.length > 256 || directory.has(name)) return invalid();
      const dimensions = u32();
      if (dimensions < 1 || dimensions > 4) return invalid();
      const shape: number[] = [];
      for (let dimension = 0; dimension < dimensions; dimension++) {
        const extent = u64();
        if (extent < 1) return invalid();
        shape.push(extent);
      }
      u32();
      u64();
      directory.set(name, shape);
    }
    const speculativeHead = classifySpeculativeGGUF(architecture, metadata, directory);
    const contextLimit =
      metadata.get(`${architecture}.context_length`) ?? (speculativeHead ? 0 : undefined);
    if (
      !Number.isSafeInteger(contextLimit) ||
      Number(contextLimit) < (speculativeHead ? 0 : 1) ||
      Number(contextLimit) > 2147483647
    )
      return invalid();
    const hash = createHash('sha256');
    if (hashPayload)
      for await (const chunk of handle.createReadStream({ start: 0, autoClose: false })) {
        const bytes: unknown = chunk;
        if (!Buffer.isBuffer(bytes)) return invalid();
        hash.update(bytes);
      }
    const after = await handle.stat();
    if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ino !== stat.ino)
      return invalid();
    const display = (key: string) => {
      const value = metadata.get(key);
      return typeof value === 'string' &&
        value.trim() &&
        value.length <= 256 &&
        !Array.from(value).some(
          (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
        )
        ? value.trim()
        : undefined;
    };
    const name = display('general.name'),
      parameters = display('general.size_label'),
      fileType = metadata.get('general.file_type');
    const blocks = metadata.get(`${architecture}.block_count`);
    const blockCount =
      typeof blocks === 'number' &&
      Number.isSafeInteger(blocks) &&
      blocks > 0 &&
      blocks < 2147483647
        ? blocks
        : null;
    const nextnKey = `${architecture}.nextn_predict_layers`,
      nextn = metadata.get(nextnKey),
      template = metadata.get('tokenizer.chat_template');
    if (
      metadata.has(nextnKey) &&
      (typeof nextn !== 'number' ||
        !Number.isSafeInteger(nextn) ||
        nextn < 0 ||
        blockCount === null ||
        nextn >= blockCount)
    )
      return invalid();
    return Object.freeze({
      architecture,
      ...(speculativeHead ? { speculativeHead } : {}),
      contextLimit: Number(contextLimit),
      tensors,
      blockCount,
      ...(typeof nextn === 'number' ? { nextnPredictLayers: nextn } : {}),
      ...(typeof template === 'string'
        ? { thinkingSupported: /\benable_thinking\b/u.test(template) }
        : {}),
      ...(hashPayload ? { sha256: hash.digest('hex') } : {}),
      ...(name ? { name } : {}),
      ...(parameters ? { parameters } : {}),
      ...(typeof fileType === 'number' ? { quantization: fileTypes[fileType] ?? 'Unknown' } : {}),
    });
  } catch {
    return invalid();
  } finally {
    await handle.close();
  }
}
