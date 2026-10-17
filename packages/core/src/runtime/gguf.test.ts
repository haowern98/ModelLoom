import { afterEach, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { inspectGGUF } from './gguf.js';
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
function u32(value: number) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(value);
  return b;
}
function u64(value: bigint) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(value);
  return b;
}
function str(value: string) {
  return Buffer.concat([u64(BigInt(Buffer.byteLength(value))), Buffer.from(value)]);
}
function fixture(context = 4096) {
  return Buffer.concat([
    Buffer.from('GGUF'),
    u32(3),
    u64(1n),
    u64(2n),
    str('general.architecture'),
    u32(8),
    str('llama'),
    str('llama.context_length'),
    u32(4),
    u32(context),
  ]);
}
async function file(bytes: Buffer) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'modelloom-gguf-'));
  dirs.push(dir);
  const target = path.join(dir, 'model.gguf');
  await writeFile(target, bytes);
  return target;
}
it('reads bounded model context and exact file identity without estimating memory', async () => {
  const bytes = fixture();
  expect(await inspectGGUF(await file(bytes))).toEqual({
    architecture: 'llama',
    contextLimit: 4096,
    blockCount: null,
    tensors: 1,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
});
it('reads repeating blocks from architecture metadata, never the tensor count', async () => {
  const header = fixture();
  header.writeBigUInt64LE(3n, 16);
  const bytes = Buffer.concat([header, str('llama.block_count'), u32(4), u32(64)]);
  expect(await inspectGGUF(await file(bytes))).toMatchObject({ tensors: 1, blockCount: 64 });
});
it.each([0, 4294967295])('keeps invalid block metadata unavailable (%s)', async (count) => {
  const header = fixture();
  header.writeBigUInt64LE(3n, 16);
  const bytes = Buffer.concat([header, str('llama.block_count'), u32(4), u32(count)]);
  expect((await inspectGGUF(await file(bytes))).blockCount).toBeNull();
});
function topologyFixture(nextn?: number, template?: string) {
  const fields = [
    str('general.architecture'),
    u32(8),
    str('qwen35'),
    str('qwen35.context_length'),
    u32(4),
    u32(262144),
    str('qwen35.block_count'),
    u32(4),
    u32(65),
  ];
  if (nextn !== undefined) fields.push(str('qwen35.nextn_predict_layers'), u32(4), u32(nextn));
  if (template !== undefined) fields.push(str('tokenizer.chat_template'), u32(8), str(template));
  return Buffer.concat([
    Buffer.from('GGUF'),
    u32(3),
    u64(866n),
    u64(BigInt(3 + Number(nextn !== undefined) + Number(template !== undefined))),
    ...fields,
  ]);
}
it('preserves allocation blocks while exposing an optional NextN count', async () => {
  const dense = await inspectGGUF(await file(topologyFixture()));
  expect(dense.blockCount).toBe(65);
  expect(dense).not.toHaveProperty('nextnPredictLayers');
  expect(await inspectGGUF(await file(topologyFixture(1)))).toMatchObject({
    blockCount: 65,
    nextnPredictLayers: 1,
  });
  expect(await inspectGGUF(await file(topologyFixture(0)))).toMatchObject({
    nextnPredictLayers: 0,
  });
});
it.each([65, 66, 4294967295])(
  'rejects NextN counts without an inference trunk (%s)',
  async (nextn) => {
    await expect(inspectGGUF(await file(topologyFixture(nextn)))).rejects.toThrow('INVALID_GGUF');
  },
);
it('returns a bounded thinking hint without exposing tokenizer templates', async () => {
  const info = await inspectGGUF(
    await file(topologyFixture(1, '{% if enable_thinking %}reason{% endif %}')),
  );
  expect(info.thinkingSupported).toBe(true);
  expect(info).not.toHaveProperty('chatTemplate');
  expect(await inspectGGUF(await file(topologyFixture(undefined, 'plain template')))).toMatchObject(
    { thinkingSupported: false },
  );
  expect(
    await inspectGGUF(await file(topologyFixture(undefined, 'not_enable_thinking'))),
  ).toMatchObject({ thinkingSupported: false });
});
it('indexes optional display metadata from GGUF rather than a fixed model profile', async () => {
  const header = fixture();
  header.writeBigUInt64LE(5n, 16);
  const bytes = Buffer.concat([
    header,
    str('general.name'),
    u32(8),
    str('Observed model'),
    str('general.file_type'),
    u32(4),
    u32(15),
    str('general.size_label'),
    u32(8),
    str('8B'),
  ]);
  expect(await inspectGGUF(await file(bytes))).toMatchObject({
    name: 'Observed model',
    quantization: 'Q4_K_M',
    parameters: '8B',
  });
});
it('accepts a normal large tokenizer array within the metadata byte budget', async () => {
  const header = fixture();
  header.writeBigUInt64LE(3n, 16);
  const bytes = Buffer.concat([
    header,
    str('tokenizer.ggml.tokens'),
    u32(9),
    u32(8),
    u64(32768n),
    ...Array.from({ length: 32768 }, () => str('token')),
  ]);
  expect(await inspectGGUF(await file(bytes))).toMatchObject({
    architecture: 'llama',
    contextLimit: 4096,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
});
it('still rejects a tokenizer array whose declared count exceeds the bounded header', async () => {
  const header = fixture();
  header.writeBigUInt64LE(3n, 16);
  await expect(
    inspectGGUF(
      await file(
        Buffer.concat([header, str('tokenizer.ggml.tokens'), u32(9), u32(8), u64(1000001n)]),
      ),
    ),
  ).rejects.toThrow('INVALID_GGUF');
});
it.each([
  Buffer.from('notGGUF'),
  Buffer.concat([Buffer.from('GGUF'), u32(3), u64(1n), u64(99999999999n)]),
  fixture(0),
  fixture().subarray(0, 45),
  Buffer.concat([Buffer.from('GGUF'), u32(3), u64(1n), u64(1n), u64(0xffffffffffffffffn)]),
])('rejects truncated, overflowing or unsupported metadata', async (bytes) => {
  await expect(inspectGGUF(await file(bytes))).rejects.toThrow('INVALID_GGUF');
});
