import { createHash } from 'node:crypto';

const literalLimit = 64 * 1024;
const entryLimit = 4 * 1024 * 1024 + 9;
const cacheLimit = 64 * 1024 * 1024;
const entryCount = 4096;
type Emit = (bytes: Buffer) => Promise<void>;
const invalid = (): never => {
  throw Error('RPC_RESIDENCY_INVALID');
};

function frame(kind: number, slot: number, bytes: Buffer): Buffer {
  const header = Buffer.alloc(9);
  header[0] = kind;
  header.writeUInt32LE(slot, 1);
  header.writeUInt32LE(bytes.length, 5);
  return Buffer.concat([header, bytes]);
}

/** Literal native bytes; this header exists only between negotiated app peers. */
export function residencyLiteral(bytes: Buffer): Buffer {
  if (!bytes.length || bytes.length > literalLimit) return invalid();
  return frame(0, 0, bytes);
}

class Hello {
  private prefix: Buffer = Buffer.alloc(72);
  private used = 0;
  private length: number | undefined;
  mode: 'waiting' | 'cached' | 'literal' = 'waiting';
  observe(bytes: Buffer): void {
    if (this.mode !== 'waiting') return;
    const count = Math.min(bytes.length, this.prefix.length - this.used);
    bytes.copy(this.prefix, this.used, 0, count);
    this.used += count;
    if (this.used < 8) return;
    const length = this.prefix.readBigUInt64LE();
    if (length < 4 || length > 64) {
      this.mode = 'literal';
      return;
    }
    this.length = Number(length) + 8;
    if (this.used < this.length) return;
    this.mode = [6, 7, 8].includes(this.prefix[8]!) ? 'cached' : 'literal';
    this.prefix = Buffer.alloc(0);
  }
}

class Dictionary {
  readonly entries = new Map<number, { bytes: Buffer; hash: string }>();
  private readonly hashes = new Map<string, number>();
  bytes = 0;
  private next = 1;
  private lastReceived = 0;
  encode(bytes: Buffer): Buffer {
    const hash = createHash('sha256').update(bytes).digest('hex');
    const found = this.hashes.get(hash);
    if (found !== undefined && this.entries.get(found)?.bytes.equals(bytes))
      return frame(2, found, Buffer.alloc(0));
    if (this.next === 0xffffffff) return invalid();
    const id = this.next++;
    this.store(id, bytes, hash);
    return frame(1, id, bytes);
  }
  define(id: number, bytes: Buffer): void {
    if (id !== this.lastReceived + 1) return invalid();
    this.lastReceived = id;
    this.store(id, bytes, createHash('sha256').update(bytes).digest('hex'));
  }
  private store(id: number, bytes: Buffer, hash: string): void {
    while (this.bytes + bytes.length > cacheLimit || this.entries.size >= entryCount) {
      const [oldId, old] = this.entries.entries().next().value!;
      this.entries.delete(oldId);
      if (this.hashes.get(old.hash) === oldId) this.hashes.delete(old.hash);
      this.bytes -= old.bytes.length;
    }
    this.entries.set(id, { bytes: Buffer.from(bytes), hash });
    this.hashes.set(hash, id);
    this.bytes += bytes.length;
  }
  clear(): void {
    this.entries.clear();
    this.hashes.clear();
    this.bytes = 0;
  }
}

/** Encode original requests only. Known HELLOs enable exact whole-SET reuse;
 * unsupported versions retain literal transport. Calls are serialized by Duplex.
 * Every emit is awaited, and large model tensors stream with bounded staging. */
export class RpcResidencyEncoder {
  private readonly hello = new Hello();
  private readonly dictionary = new Dictionary();
  private header: Buffer = Buffer.alloc(9);
  private used = 0;
  private remaining = 0n;
  private staged: Buffer | undefined;
  private stagedOffset = 0;
  private references = 0;
  private reusedBytes = 0;
  get stats() {
    return {
      entries: this.dictionary.entries.size,
      cachedBytes: this.dictionary.bytes,
      references: this.references,
      reusedBytes: this.reusedBytes,
    };
  }
  observeReply(bytes: Buffer): void {
    this.hello.observe(bytes);
  }
  async write(bytes: Buffer, emit: Emit): Promise<void> {
    if (this.hello.mode === 'literal') {
      await this.literal(bytes, emit);
      return;
    }
    let offset = 0;
    while (offset < bytes.length) {
      if (!this.remaining) {
        const count = Math.min(9 - this.used, bytes.length - offset);
        bytes.copy(this.header, this.used, offset, offset + count);
        offset += count;
        this.used += count;
        if (this.used < 9) return;
        const length = this.header.readBigUInt64LE(1);
        this.remaining = length;
        this.used = 0;
        if (
          this.hello.mode === 'cached' &&
          this.header[0] === 6 &&
          length >= 512 &&
          length + 9n <= entryLimit
        ) {
          this.staged = Buffer.allocUnsafe(Number(length) + 9);
          this.header.copy(this.staged);
          this.stagedOffset = 9;
        } else await emit(residencyLiteral(this.header));
        if (!this.remaining) continue;
      }
      const available = BigInt(bytes.length - offset);
      const count = Number(this.remaining < available ? this.remaining : available);
      if (this.staged) {
        bytes.copy(this.staged, this.stagedOffset, offset, offset + count);
        this.stagedOffset += count;
      } else await this.literal(bytes.subarray(offset, offset + count), emit);
      this.remaining -= BigInt(count);
      offset += count;
      if (!this.remaining && this.staged) {
        const record = this.staged;
        this.staged = undefined;
        const encoded = this.dictionary.encode(record);
        if (encoded[0] === 2) {
          this.references++;
          this.reusedBytes += record.length;
        }
        await emit(encoded);
      }
    }
  }
  private async literal(bytes: Buffer, emit: Emit): Promise<void> {
    for (let offset = 0; offset < bytes.length; offset += literalLimit)
      await emit(residencyLiteral(bytes.subarray(offset, offset + literalLimit)));
  }
  finish(): void {
    if (this.used || this.remaining) return invalid();
  }
  clear(): void {
    this.dictionary.clear();
    this.staged = undefined;
    this.header = Buffer.alloc(0);
  }
}

/** Decode only the private data codec, never helper control. Each reference
 * restores the full original SET bytes even when GPU buffers have been modified.
 * Missing references and partial EOF fail closed without executing a replay. */
export class RpcResidencyDecoder {
  private readonly hello = new Hello();
  private readonly dictionary = new Dictionary();
  private header: Buffer = Buffer.alloc(9);
  private used = 0;
  private body: Buffer | undefined;
  private filled = 0;
  private kind = 0;
  private slot = 0;
  private references = 0;
  private reusedBytes = 0;
  get stats() {
    return {
      entries: this.dictionary.entries.size,
      cachedBytes: this.dictionary.bytes,
      references: this.references,
      reusedBytes: this.reusedBytes,
    };
  }
  observeReply(bytes: Buffer): void {
    this.hello.observe(bytes);
  }
  async write(bytes: Buffer, emit: Emit): Promise<void> {
    let offset = 0;
    while (offset < bytes.length) {
      if (!this.body) {
        const count = Math.min(9 - this.used, bytes.length - offset);
        bytes.copy(this.header, this.used, offset, offset + count);
        offset += count;
        this.used += count;
        if (this.used < 9) return;
        this.kind = this.header[0]!;
        this.slot = this.header.readUInt32LE(1);
        const length = this.header.readUInt32LE(5);
        this.used = 0;
        if (this.kind === 2) {
          if (length || !this.slot || this.hello.mode !== 'cached') return invalid();
          const entry = this.dictionary.entries.get(this.slot);
          if (!entry) return invalid();
          this.references++;
          this.reusedBytes += entry.bytes.length;
          await emit(entry.bytes);
          continue;
        }
        if (this.kind === 0) {
          if (this.slot || !length || length > literalLimit) return invalid();
        } else if (this.kind === 1) {
          if (!this.slot || length < 521 || length > entryLimit || this.hello.mode !== 'cached')
            return invalid();
        } else return invalid();
        this.body = Buffer.allocUnsafe(length);
        this.filled = 0;
      }
      const count = Math.min(this.body.length - this.filled, bytes.length - offset);
      bytes.copy(this.body, this.filled, offset, offset + count);
      this.filled += count;
      offset += count;
      if (this.filled === this.body.length) {
        const body = this.body;
        this.body = undefined;
        if (this.kind === 1) {
          if (body[0] !== 6 || body.readBigUInt64LE(1) !== BigInt(body.length - 9))
            return invalid();
          this.dictionary.define(this.slot, body);
        }
        await emit(body);
      }
    }
  }
  finish(): void {
    if (this.used || this.body) return invalid();
  }
  clear(): void {
    this.dictionary.clear();
    this.body = undefined;
    this.header = Buffer.alloc(0);
  }
}
