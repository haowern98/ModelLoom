import type { SpeculativeHeadKind } from '../model-configuration/model-source.js';

export type TensorDirectory = ReadonlyMap<string, readonly number[]>;
const invalid = (): never => {
  throw new Error('INVALID_GGUF');
};

/** Structural identification only; runtime loading still validates executable tensors and pairing. */
export function classifySpeculativeGGUF(
  architecture: string,
  metadata: ReadonlyMap<string, unknown>,
  tensors: TensorDirectory,
): SpeculativeHeadKind | undefined {
  const integer = (key: string, minimum = 1): number => {
    const value = metadata.get(`${architecture}.${key}`);
    if (
      typeof value !== 'number' ||
      !Number.isSafeInteger(value) ||
      value < minimum ||
      value > 2147483647
    )
      return invalid();
    return value;
  };
  const shape = (name: string, expected: readonly number[]) => {
    const actual = tensors.get(name);
    if (!actual || actual.length !== expected.length || actual.some((n, i) => n !== expected[i]))
      invalid();
  };
  const optionalShape = (name: string, expected: readonly number[]) => {
    if (tensors.has(name)) shape(name, expected);
  };
  const matrix = (name: string): readonly number[] => {
    const dimensions = tensors.get(name);
    if (!dimensions || dimensions.length !== 2) return invalid();
    return dimensions;
  };
  const nextnNames = [...tensors.keys()].filter((name) => name.includes('.nextn.'));
  if (architecture !== 'eagle3' && architecture !== 'dflash') {
    const count = metadata.get(`${architecture}.nextn_predict_layers`);
    if (!nextnNames.length && (count === undefined || count === 0)) return;
    const heads = integer('nextn_predict_layers');
    const blocks = integer('block_count');
    if (heads >= blocks) return invalid();
    const firstHead = blocks - heads;
    const blockIds = new Set<number>();
    for (const name of tensors.keys()) {
      const match = /^blk\.(\d+)\./u.exec(name);
      if (match) {
        const index = Number(match[1]);
        if (!Number.isSafeInteger(index) || index >= blocks) return invalid();
        blockIds.add(index);
      }
    }
    const trunkIds = [...blockIds].filter((index) => index < firstHead);
    const fullTrunk = trunkIds.length === firstHead;
    if (trunkIds.length && !fullTrunk) return invalid();
    const width = integer('embedding_length');
    if (fullTrunk) {
      for (let index = 0; index < firstHead; index++)
        shape(`blk.${index}.attn_norm.weight`, [width]);
    }
    if (!nextnNames.length) {
      // Older converters advertise NextN even when exporting only the full target trunk.
      if (!fullTrunk) return invalid();
      return;
    }
    for (const name of nextnNames) {
      const match = /^blk\.(\d+)\.nextn\./u.exec(name);
      if (!match || Number(match[1]) < firstHead || Number(match[1]) >= blocks) return invalid();
    }
    for (let index = firstHead; index < blocks; index++) {
      shape(`blk.${index}.nextn.eh_proj.weight`, [2 * width, width]);
      shape(`blk.${index}.nextn.enorm.weight`, [width]);
      shape(`blk.${index}.nextn.hnorm.weight`, [width]);
      shape(`blk.${index}.attn_norm.weight`, [width]);
    }
    if (fullTrunk) return;
    return 'mtp';
  }
  if (nextnNames.length) return invalid();
  const width = integer('embedding_length');
  const blocks = integer('block_count');
  for (const name of tensors.keys()) {
    const match = /^blk\.(\d+)\./u.exec(name);
    if (match && Number(match[1]) >= blocks) return invalid();
  }
  const layers = metadata.get(`${architecture}.target_layers`);
  if (
    !Array.isArray(layers) ||
    !layers.length ||
    layers.length > 4096 ||
    layers.some(
      (n: unknown) => typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0 || n > 2147483647,
    ) ||
    new Set(layers).size !== layers.length
  )
    return invalid();
  const inputWidth =
    architecture === 'eagle3' ? 3 * integer('target_hidden_size') : layers.length * width;
  if (architecture === 'eagle3' && (blocks !== 1 || layers.length !== 3)) return invalid();
  shape('fc.weight', [inputWidth, width]);
  shape('output_norm.weight', [width]);
  if (architecture === 'dflash') shape('enc.output_norm.weight', [width]);
  if (architecture === 'eagle3' && metadata.get('eagle3.norm_before_fc') === true)
    shape('enc.output_norm.weight', [inputWidth]);
  for (let index = 0; index < blocks; index++) {
    shape(`blk.${index}.attn_norm.weight`, [width]);
    shape(`blk.${index}.ffn_norm.weight`, [width]);
    if (architecture === 'eagle3') shape(`blk.${index}.attn_norm_2.weight`, [width]);
  }
  const mapping = tensors.get('d2t');
  if (mapping && mapping.length !== 1) return invalid();
  if (tensors.has('output.weight')) {
    const output = matrix('output.weight');
    if (output[0] !== width || (mapping && output[1] !== mapping[0])) return invalid();
  }
  if (tensors.has('token_embd.weight') && matrix('token_embd.weight')[0] !== width)
    return invalid();
  const w1 = tensors.get('markov_w1.weight'),
    w2 = tensors.get('markov_w2.weight');
  if (Boolean(w1) !== Boolean(w2) || (architecture === 'eagle3' && (w1 || w2))) return invalid();
  if (w1 && w2) {
    if (
      w1.length !== 2 ||
      w2.length !== 2 ||
      w1[0] !== w2[0] ||
      (mapping ? w2[1] !== mapping[0] : w1[1] !== w2[1])
    )
      return invalid();
    optionalShape('markov_w2.scale', [1]);
    optionalShape('conf_proj.weight', [width + w1[0]!, 1]);
    optionalShape('conf_proj.bias', [1]);
  } else if ([...tensors.keys()].some((name) => /^(markov_|conf_proj\.)/u.test(name)))
    return invalid();
  const selectorNames = [
    'selector_hidden.weight',
    'selector_predecessor.weight',
    'selector_successor.weight',
  ];
  if (
    [...tensors.keys()].some(
      (name) => name.startsWith('selector_') || /\.(?:attn|ffn)_conv_/u.test(name),
    )
  ) {
    if (architecture !== 'dflash') return invalid();
    const rank = integer('selector_rank'),
      kernel = integer('conv_kernel_size'),
      group = integer('conv_group_size');
    const topK = integer('selector_top_k');
    integer('block_size');
    if (width % group || width < topK * (topK + 1)) return invalid();
    shape(selectorNames[0]!, [width, rank]);
    const previous = matrix(selectorNames[1]!),
      next = matrix(selectorNames[2]!);
    if (previous[0] !== rank || next[0] !== rank || previous[1] !== next[1]) return invalid();
    for (let index = 0; index < blocks; index++) {
      for (const part of ['attn', 'ffn']) {
        shape(`blk.${index}.${part}_conv_base`, [width, kernel, 2]);
        shape(`blk.${index}.${part}_conv_proj.weight`, [width, 2 * kernel * (width / group)]);
      }
    }
  }
  return w1 ? 'dspark' : architecture;
}
