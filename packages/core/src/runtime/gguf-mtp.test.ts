import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { inspectGGUF, inspectGGUFHeader } from './gguf.js';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const architectures = [
  'qwen35',
  'qwen35moe',
  'qwen3next',
  'deepseek2',
  'deepseek32',
  'deepseek4',
  'glm4moe',
  'glm-dsa',
  'step35',
  'hy_v3',
  'bailingmoe3',
  'cohere2moe',
  'nemotron_h',
  'nemotron_h_moe',
  'dots3note',
  'exaone4',
  'exaone-moe',
  'bailingmoe2',
  'glm4',
  'mimo2',
] as const;
interface Tensor {
  name: string;
  dimensions: number[];
}
const width = 8;
function u32(value: number) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value);
  return buffer;
}
function u64(value: number) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(value));
  return buffer;
}
function string(value: string) {
  return Buffer.concat([u64(Buffer.byteLength(value)), Buffer.from(value)]);
}
function head(index: number): Tensor[] {
  return [
    { name: `blk.${index}.nextn.eh_proj.weight`, dimensions: [2 * width, width] },
    { name: `blk.${index}.nextn.enorm.weight`, dimensions: [width] },
    { name: `blk.${index}.nextn.hnorm.weight`, dimensions: [width] },
    { name: `blk.${index}.attn_norm.weight`, dimensions: [width] },
  ];
}
function trunk(count = 3): Tensor[] {
  return Array.from({ length: count }, (_, index) => ({
    name: `blk.${index}.attn_norm.weight`,
    dimensions: [width],
  }));
}
function fixture(
  architecture: string,
  tensors: Tensor[],
  options: { blocks?: number; nextn?: number | null } = {},
) {
  const nextn = options.nextn === undefined ? 2 : options.nextn;
  const entries = [
    Buffer.concat([string('general.architecture'), u32(8), string(architecture)]),
    Buffer.concat([string(`${architecture}.context_length`), u32(4), u32(4096)]),
    Buffer.concat([string(`${architecture}.embedding_length`), u32(4), u32(width)]),
    Buffer.concat([string(`${architecture}.block_count`), u32(4), u32(options.blocks ?? 5)]),
    ...(nextn === null
      ? []
      : [Buffer.concat([string(`${architecture}.nextn_predict_layers`), u32(4), u32(nextn)])]),
  ];
  return Buffer.concat([
    Buffer.from('GGUF'),
    u32(3),
    u64(tensors.length),
    u64(entries.length),
    ...entries,
    ...tensors.map((tensor) =>
      Buffer.concat([
        string(tensor.name),
        u32(tensor.dimensions.length),
        ...tensor.dimensions.map(u64),
        u32(0),
        u64(0),
      ]),
    ),
  ]);
}
async function file(bytes: Buffer, filename = 'model.gguf') {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'modelloom-mtp-'));
  directories.push(directory);
  const filenamePath = path.join(directory, filename);
  await writeFile(filenamePath, bytes);
  return filenamePath;
}

it.each(architectures)(
  'classifies %s MTP-only content using dynamic block indices',
  async (architecture) => {
    const result = await inspectGGUF(await file(fixture(architecture, [...head(3), ...head(4)])));
    expect(result).toMatchObject({ architecture, speculativeHead: 'mtp', nextnPredictLayers: 2 });
  },
);

it('keeps a full target with complete embedded MTP under Models', async () => {
  const result = await inspectGGUF(
    await file(fixture('qwen35', [...trunk(), ...head(3), ...head(4)])),
  );
  expect(result).not.toHaveProperty('speculativeHead');
});

it('keeps a complete trunk-only target when metadata still advertises absent MTP heads', async () => {
  const result = await inspectGGUF(await file(fixture('deepseek32', trunk())));
  expect(result).not.toHaveProperty('speculativeHead');
});

it.each([
  [
    'unrelated tensor names masquerading as ordinary blocks',
    trunk().map((_tensor, index) => ({
      name: `blk.${index}.unrelated.weight`,
      dimensions: [width],
    })),
  ],
  [
    'ordinary normalization tensors with the wrong hidden width',
    trunk().map((tensor) => ({ ...tensor, dimensions: [width + 1] })),
  ],
])('rejects advertised-MTP trunk-only metadata with %s', async (_description, tensors) => {
  await expect(inspectGGUF(await file(fixture('deepseek32', tensors)))).rejects.toThrow(
    'INVALID_GGUF',
  );
});

it('does not let a misleading filename override full-target contents', async () => {
  const result = await inspectGGUF(
    await file(fixture('qwen35moe', [...trunk(), ...head(3), ...head(4)]), 'mtp-head-only.gguf'),
  );
  expect(result).not.toHaveProperty('speculativeHead');
});

it.each([
  [
    'missing a normalization tensor',
    [...head(3), ...head(4)].filter((tensor) => tensor.name !== 'blk.4.nextn.hnorm.weight'),
  ],
  ['missing an entire declared MTP block', head(3)],
  [
    'incorrect projection dimensions',
    [...head(3), ...head(4)].map((tensor) =>
      tensor.name === 'blk.4.nextn.eh_proj.weight'
        ? { ...tensor, dimensions: [width, 2 * width] }
        : tensor,
    ),
  ],
  [
    'inconsistent normalization dimensions',
    [...head(3), ...head(4)].map((tensor) =>
      tensor.name === 'blk.4.nextn.enorm.weight' ? { ...tensor, dimensions: [width + 1] } : tensor,
    ),
  ],
  ['out-of-range NextN block', [...head(3), ...head(4), ...head(5)]],
  ['partial ordinary trunk', [...trunk().slice(1), ...head(3), ...head(4)]],
  ['partial trunk without MTP weights', trunk().slice(1)],
])('rejects MTP metadata with %s', async (_description, tensors) => {
  await expect(inspectGGUF(await file(fixture('qwen35', tensors)))).rejects.toThrow('INVALID_GGUF');
});

it('rejects NextN tensors when the head-count metadata is absent', async () => {
  await expect(
    inspectGGUF(await file(fixture('qwen35', head(3), { nextn: null }))),
  ).rejects.toThrow('INVALID_GGUF');
});

it('reads the same classification from the bounded header without hashing weight payloads', async () => {
  const filename = await file(fixture('step35', [...head(3), ...head(4)]));
  const header = await inspectGGUFHeader(filename);
  expect(header).toMatchObject({
    architecture: 'step35',
    speculativeHead: 'mtp',
    nextnPredictLayers: 2,
  });
  expect(header).not.toHaveProperty('sha256');
});
