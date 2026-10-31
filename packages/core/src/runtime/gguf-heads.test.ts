import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { inspectGGUF } from './gguf.js';

interface Tensor {
  name: string;
  shape: readonly number[];
}
interface Fixture {
  architecture: string;
  fields: Record<string, number | readonly number[]>;
  tensors: readonly Tensor[];
}
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
function u32(n: number) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
}
function i32(n: number) {
  const b = Buffer.alloc(4);
  b.writeInt32LE(n);
  return b;
}
function u64(n: number) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
}
function str(s: string) {
  return Buffer.concat([u64(Buffer.byteLength(s)), Buffer.from(s)]);
}
function encode(spec: Fixture, truncateDirectory = false) {
  const entries = Object.entries(spec.fields).map(([key, value]) =>
    Buffer.concat([
      str(key),
      ...(typeof value === 'number'
        ? [u32(4), u32(value)]
        : [u32(9), u32(5), u64(value.length), ...value.map(i32)]),
    ]),
  );
  let dataSize = 0;
  const descriptors = spec.tensors.map(({ name, shape }) => {
    const offset = dataSize;
    dataSize += Math.ceil((shape.reduce((product, n) => product * n, 1) * 4) / 32) * 32;
    return Buffer.concat([str(name), u32(shape.length), ...shape.map(u64), u32(0), u64(offset)]);
  });
  const directory = Buffer.concat([
    Buffer.from('GGUF'),
    u32(3),
    u64(spec.tensors.length),
    u64(entries.length + 1),
    str('general.architecture'),
    u32(8),
    str(spec.architecture),
    ...entries,
    ...descriptors,
  ]);
  if (truncateDirectory) return directory.subarray(0, -1);
  return Buffer.concat([
    directory,
    Buffer.alloc((32 - (directory.length % 32)) % 32),
    Buffer.alloc(dataSize),
  ]);
}
async function file(bytes: Buffer, name = 'model.gguf') {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'modelloom-head-'));
  dirs.push(dir);
  const filename = path.join(dir, name);
  await writeFile(filename, bytes);
  return filename;
}
function eagle(): Fixture {
  return {
    architecture: 'eagle3',
    fields: {
      'eagle3.block_count': 1,
      'eagle3.embedding_length': 4,
      'eagle3.target_hidden_size': 8,
      'eagle3.target_layers': [1, 3, 5],
    },
    tensors: [
      { name: 'fc.weight', shape: [24, 4] },
      { name: 'output_norm.weight', shape: [4] },
      { name: 'blk.0.attn_norm.weight', shape: [4] },
      { name: 'blk.0.attn_norm_2.weight', shape: [4] },
      { name: 'blk.0.ffn_norm.weight', shape: [4] },
    ],
  };
}
function dflash(): Fixture {
  return {
    architecture: 'dflash',
    fields: {
      'dflash.block_count': 2,
      'dflash.embedding_length': 4,
      'dflash.target_layers': [1, 3],
    },
    tensors: [
      { name: 'fc.weight', shape: [8, 4] },
      { name: 'enc.output_norm.weight', shape: [4] },
      { name: 'output_norm.weight', shape: [4] },
      ...[0, 1].flatMap((block) => [
        { name: `blk.${block}.attn_norm.weight`, shape: [4] },
        { name: `blk.${block}.ffn_norm.weight`, shape: [4] },
      ]),
    ],
  };
}
function dspark(): Fixture {
  const base = dflash();
  return {
    ...base,
    tensors: [
      ...base.tensors,
      { name: 'markov_w1.weight', shape: [2, 10] },
      { name: 'markov_w2.weight', shape: [2, 6] },
      { name: 'd2t', shape: [6] },
    ],
  };
}
function dflash2(): Fixture {
  const base = dflash();
  return {
    ...base,
    fields: {
      ...base.fields,
      'dflash.block_size': 8,
      'dflash.conv_kernel_size': 2,
      'dflash.conv_group_size': 2,
      'dflash.selector_rank': 2,
      'dflash.selector_top_k': 1,
    },
    tensors: [
      ...base.tensors,
      { name: 'selector_hidden.weight', shape: [4, 2] },
      { name: 'selector_predecessor.weight', shape: [2, 10] },
      { name: 'selector_successor.weight', shape: [2, 10] },
      ...[0, 1].flatMap((block) => [
        { name: `blk.${block}.attn_conv_base`, shape: [4, 2, 2] },
        { name: `blk.${block}.attn_conv_proj.weight`, shape: [4, 8] },
        { name: `blk.${block}.ffn_conv_base`, shape: [4, 2, 2] },
        { name: `blk.${block}.ffn_conv_proj.weight`, shape: [4, 8] },
      ]),
    ],
  };
}
function without(spec: Fixture, name: string): Fixture {
  return { ...spec, tensors: spec.tensors.filter((tensor) => tensor.name !== name) };
}
function reshaped(spec: Fixture, name: string, shape: readonly number[]): Fixture {
  return {
    ...spec,
    tensors: spec.tensors.map((tensor) => (tensor.name === name ? { ...tensor, shape } : tensor)),
  };
}

it.each([
  ['EAGLE-3', eagle, 'eagle3'],
  ['DFlash', dflash, 'dflash'],
  ['DSpark', dspark, 'dspark'],
  ['DFlash2', dflash2, 'dflash'],
] as const)(
  'recognizes coherent %s companion metadata and descriptors',
  async (_name, make, kind) => {
    expect(await inspectGGUF(await file(encode(make())))).toMatchObject({
      architecture: kind === 'eagle3' ? 'eagle3' : 'dflash',
      speculativeHead: kind,
      contextLimit: 0,
    });
  },
);
it('accepts EAGLE-3 signed target layers and optional reduced-vocabulary projection', async () => {
  const spec = eagle();
  spec.tensors = [
    ...spec.tensors,
    { name: 'd2t', shape: [6] },
    { name: 'output.weight', shape: [4, 6] },
  ];
  expect(await inspectGGUF(await file(encode(spec)))).toHaveProperty('speculativeHead', 'eagle3');
});
it.each([
  { 'eagle3.target_layers': [1, 3] },
  { 'eagle3.target_layers': [1, 1, 3] },
  { 'eagle3.target_layers': [-1, 3, 5] },
  { 'eagle3.target_hidden_size': 0 },
  { 'eagle3.block_count': 2 },
])('rejects inconsistent EAGLE-3 metadata %j', async (fields) => {
  const spec = eagle();
  await expect(
    inspectGGUF(await file(encode({ ...spec, fields: { ...spec.fields, ...fields } }))),
  ).rejects.toThrow('INVALID_GGUF');
});
it.each([
  ['EAGLE fusion width', reshaped(eagle(), 'fc.weight', [8, 4])],
  ['EAGLE hidden norm', reshaped(eagle(), 'blk.0.attn_norm_2.weight', [3])],
  ['DFlash final norm', reshaped(dflash(), 'output_norm.weight', [3])],
  ['DFlash block norm', without(dflash(), 'blk.1.ffn_norm.weight')],
  ['DFlash projection', without(dflash(), 'fc.weight')],
])('rejects an incomplete or inconsistent %s', async (_label, spec) => {
  await expect(inspectGGUF(await file(encode(spec)))).rejects.toThrow('INVALID_GGUF');
});
it.each([
  without(dspark(), 'markov_w1.weight'),
  without(dspark(), 'markov_w2.weight'),
  reshaped(dspark(), 'markov_w2.weight', [3, 6]),
  reshaped(dspark(), 'd2t', [3, 2]),
])('rejects partial Markov heads or incompatible DSpark descriptor shapes', async (spec) => {
  await expect(inspectGGUF(await file(encode(spec)))).rejects.toThrow('INVALID_GGUF');
});
it.each([
  without(dflash2(), 'selector_hidden.weight'),
  without(dflash2(), 'selector_predecessor.weight'),
  without(dflash2(), 'blk.1.ffn_conv_base'),
  reshaped(dflash2(), 'selector_successor.weight', [3, 10]),
  reshaped(dflash2(), 'blk.0.attn_conv_proj.weight', [4, 4]),
])('rejects incomplete DFlash2 selector or convolution groups', async (spec) => {
  await expect(inspectGGUF(await file(encode(spec)))).rejects.toThrow('INVALID_GGUF');
});
it('rejects DFlash2 selector metadata with a non-dividing convolution group', async () => {
  const spec = dflash2();
  await expect(
    inspectGGUF(
      await file(encode({ ...spec, fields: { ...spec.fields, 'dflash.conv_group_size': 3 } })),
    ),
  ).rejects.toThrow('INVALID_GGUF');
});
it('keeps ordinary target contents in Models despite a misleading head filename', async () => {
  const spec: Fixture = {
    architecture: 'llama',
    fields: { 'llama.context_length': 4096, 'llama.block_count': 1 },
    tensors: [{ name: 'blk.0.attn_norm.weight', shape: [4] }],
  };
  expect(await inspectGGUF(await file(encode(spec), 'DFlash-eagle3.gguf'))).not.toHaveProperty(
    'speculativeHead',
  );
});
it('rejects duplicate tensor names, truncated tensor directories and unsupported extensions', async () => {
  const spec = dflash();
  await expect(
    inspectGGUF(await file(encode({ ...spec, tensors: [...spec.tensors, spec.tensors[0]!] }))),
  ).rejects.toThrow('INVALID_GGUF');
  await expect(inspectGGUF(await file(encode(spec, true)))).rejects.toThrow('INVALID_GGUF');
  await expect(inspectGGUF(await file(encode(spec), 'model.safetensors'))).rejects.toThrow(
    'INVALID_GGUF',
  );
});
