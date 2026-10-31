export type SpeculativeHeadKind = 'eagle3' | 'dflash' | 'dspark' | 'mtp';

/** Main/core-only index record. The file location is never part of a renderer reply. */
export interface ModelSource {
  readonly modelId: string;
  readonly file: string;
  readonly name: string;
  readonly size: string;
  readonly sizeBytes: number;
  readonly modifiedMs: number;
  readonly architecture: string;
  readonly contextLimit: number;
  /** Absent on the legacy index. Null means reinspection did not establish a usable count. */
  readonly blockCount?: number | null;
  readonly nextnPredictLayers?: number;
  readonly thinkingSupported?: boolean;
  readonly speculativeHead?: SpeculativeHeadKind;
  readonly classificationVersion?: 1;
  readonly quantization: string;
  readonly parameters: string;
}

/** Bounded stored metadata is a discovery hint; ownership and hash checks precede every load. */
export function decodeModelSource(input: unknown): ModelSource {
  const invalid = (): never => {
    throw new Error('INVALID_CONFIGURATION');
  };
  if (!input || typeof input !== 'object' || Array.isArray(input)) return invalid();
  const value = input as Record<string, unknown>;
  const keys = [
    'modelId',
    'file',
    'name',
    'size',
    'sizeBytes',
    'modifiedMs',
    'architecture',
    'contextLimit',
    'quantization',
    'parameters',
  ];
  if (Object.hasOwn(value, 'blockCount')) keys.push('blockCount');
  if (Object.hasOwn(value, 'nextnPredictLayers')) {
    keys.push('nextnPredictLayers');
    if (
      typeof value.nextnPredictLayers !== 'number' ||
      !Number.isSafeInteger(value.nextnPredictLayers) ||
      value.nextnPredictLayers < 0 ||
      value.nextnPredictLayers >= 2147483647 ||
      (typeof value.blockCount === 'number' && value.nextnPredictLayers >= value.blockCount)
    )
      return invalid();
  }
  if (Object.hasOwn(value, 'classificationVersion')) {
    keys.push('classificationVersion');
    if (value.classificationVersion !== 1) return invalid();
  }
  if (Object.hasOwn(value, 'speculativeHead')) {
    keys.push('speculativeHead');
    if (
      typeof value.speculativeHead !== 'string' ||
      !['eagle3', 'dflash', 'dspark', 'mtp'].includes(value.speculativeHead) ||
      (value.speculativeHead === 'mtp'
        ? value.architecture === 'eagle3' || value.architecture === 'dflash'
        : value.architecture !== (value.speculativeHead === 'eagle3' ? 'eagle3' : 'dflash'))
    )
      return invalid();
  }
  if (Object.hasOwn(value, 'thinkingSupported')) {
    keys.push('thinkingSupported');
    if (typeof value.thinkingSupported !== 'boolean') return invalid();
  }
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key)))
    return invalid();
  for (const key of [
    'modelId',
    'file',
    'name',
    'size',
    'architecture',
    'quantization',
    'parameters',
  ]) {
    const text = value[key];
    if (
      typeof text !== 'string' ||
      !text.trim() ||
      text.length > (key === 'file' ? 32000 : 256) ||
      Array.from(text).some(
        (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      )
    )
      return invalid();
  }
  if (
    typeof value.modelId !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(value.modelId) ||
    typeof value.file !== 'string' ||
    !/^[A-Za-z]:\\/u.test(value.file)
  )
    return invalid();
  for (const key of ['sizeBytes', 'contextLimit'])
    if (typeof value[key] !== 'number' || !Number.isSafeInteger(value[key]) || value[key] < 0)
      return invalid();
  if (
    (Object.hasOwn(value, 'blockCount') &&
      value.blockCount !== null &&
      (typeof value.blockCount !== 'number' ||
        !Number.isSafeInteger(value.blockCount) ||
        value.blockCount < 1 ||
        value.blockCount >= 2147483647)) ||
    typeof value.modifiedMs !== 'number' ||
    !Number.isFinite(value.modifiedMs) ||
    value.modifiedMs < 0
  )
    return invalid();
  return Object.freeze({ ...value }) as unknown as ModelSource;
}
