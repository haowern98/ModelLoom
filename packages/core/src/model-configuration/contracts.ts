/** Disabled manual values are retained for the editor; each setting defines its disabled behavior. */
export interface OptionalNumber {
  readonly enabled: boolean;
  readonly value: number;
}
/** Saved performance preferences; activation requires a matching reviewed resource profile. */
export interface LoadDefaults {
  readonly automatic: boolean;
  readonly contextLength: number;
  /** Null retains the runtime's automatic thread selection. */
  readonly threads: number | null;
  readonly evaluationBatch: number;
  readonly physicalBatch: number;
  readonly concurrency: number;
  readonly flashAttention: boolean;
}
/** Committed request defaults. Disabled filters use neutral values and Seed uses randomness. */
export interface GenerationDefaults {
  readonly temperature: number;
  readonly topK: number;
  readonly topP: OptionalNumber;
  readonly minP: OptionalNumber;
  readonly repeatPenalty: OptionalNumber;
  readonly presencePenalty: OptionalNumber;
  readonly seed: OptionalNumber;
  readonly responseLength: OptionalNumber;
  readonly systemPrompt: string;
  /** Null preserves the selected template's existing behaviour. */
  readonly thinking: boolean | null;
  readonly stopStrings: readonly string[];
}
/** Editor preferences are persisted separately and are never spread into native requests. */
export interface AdvancedPreferences {
  readonly reasoningBudget: OptionalNumber;
  readonly reasoningMessage: string;
  readonly overflow: 'truncate-middle' | 'stop' | 'rolling';
  readonly ropeBase: OptionalNumber;
  readonly ropeScale: OptionalNumber;
  readonly customTemplate: boolean;
  readonly chatTemplate: string;
  readonly argumentsEnabled: boolean;
  readonly argumentsText: string;
}
/** Identity is the verified GGUF digest, not a renderer-selected path or preview ID. */
export interface ModelConfigurationRecord {
  readonly schemaVersion: 1;
  readonly modelId: string;
  readonly revision: number;
  readonly load: LoadDefaults;
  readonly generation: GenerationDefaults;
  readonly preferences: AdvancedPreferences;
}
/** Closed native fields for a single request. They never alter engine-global defaults. */
export interface NativeGenerationParameters {
  readonly temperature: number;
  readonly top_k: number;
  readonly top_p: number;
  readonly min_p: number;
  readonly repeat_penalty: number;
  readonly presence_penalty: number;
  readonly seed: number;
  /** -1 means no reply-length cap; context capacity still bounds generation. */
  readonly max_tokens: number;
  readonly stop: readonly string[];
}
/** Validated fields supplied for one request only, without load or ownership authority. */
export type GenerationOverrides = Partial<NativeGenerationParameters>;
/** Supplied by the trusted pinned-runtime profile, never decoded from a caller payload. */
export interface RuntimeSettingCapabilities {
  readonly profileId: string;
  readonly maxOutputTokens: number;
  readonly contextLimit: number;
  readonly thinking: boolean;
  readonly nativeDefaults: Omit<NativeGenerationParameters, 'stop'>;
}
/** Trusted successful activation receipt, distinct from pending saved load preferences. */
export interface ActiveLoadSnapshot {
  readonly modelId: string;
  readonly revision: number;
  readonly profileId: string;
  readonly load: LoadDefaults;
  readonly preferences?: AdvancedPreferences;
}
/** Capture before queue admission; saving defaults cannot change this value. */
export interface ResolvedRequestSettings {
  readonly modelId: string;
  readonly activeLoadRevision: number;
  readonly generationRevision: number;
  readonly profileId: string;
  readonly contextLength: number;
  readonly parameters: NativeGenerationParameters;
  readonly systemPrompt: string;
  readonly thinking: boolean | null;
  /** Absent on older history snapshots, which always stopped at the context limit. */
  readonly overflow?: AdvancedPreferences['overflow'];
}

function invalid(): never {
  throw new Error('INVALID_CONFIGURATION');
}
function object(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return invalid();
  const value = input as Record<string, unknown>;
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key)))
    return invalid();
  return value;
}
function number(input: unknown, min: number, max: number, integer = false): number {
  if (
    typeof input !== 'number' ||
    !Number.isFinite(input) ||
    input < min ||
    input > max ||
    (integer && !Number.isSafeInteger(input))
  )
    return invalid();
  return input;
}
function boolean(input: unknown): boolean {
  return typeof input === 'boolean' ? input : invalid();
}
function text(input: unknown, max: number): string {
  if (
    typeof input !== 'string' ||
    new TextEncoder().encode(input).byteLength > max ||
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(input)
  )
    return invalid();
  return input;
}
function optional(input: unknown, min: number, max: number, integer = false): OptionalNumber {
  const value = object(input, ['enabled', 'value']);
  return Object.freeze({
    enabled: boolean(value.enabled),
    value: number(value.value, min, max, integer),
  });
}
function strings(input: unknown): readonly string[] {
  if (!Array.isArray(input) || input.length > 4) return invalid();
  const result = input.map((item: unknown) => text(item, 256));
  if (result.some((item) => !item.length)) return invalid();
  return Object.freeze(result);
}
const ranges = {
  temperature: [0, 2, false],
  top_k: [0, 2147483647, true],
  top_p: [0, 1, false],
  min_p: [0, 1, false],
  repeat_penalty: [0, 100, false],
  presence_penalty: [-2, 2, false],
  seed: [0, 4294967295, true],
  max_tokens: [1, 2147483647, true],
} as const;

/** Decode captured history/channel data. This validates syntax, never grants runtime authority. */
export function decodeResolvedRequestSettings(
  input: unknown,
  capabilities?: RuntimeSettingCapabilities,
): ResolvedRequestSettings {
  const value = object(input, [
    'modelId',
    'activeLoadRevision',
    'generationRevision',
    'profileId',
    'contextLength',
    'parameters',
    'systemPrompt',
    'thinking',
    ...(input && typeof input === 'object' && Object.hasOwn(input, 'overflow') ? ['overflow'] : []),
  ]);
  if (
    Object.hasOwn(value, 'overflow') &&
    (typeof value.overflow !== 'string' ||
      !['stop', 'truncate-middle', 'rolling'].includes(value.overflow))
  )
    return invalid();
  if (
    typeof value.modelId !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(value.modelId) ||
    typeof value.profileId !== 'string' ||
    !/^[A-Za-z0-9_-]{1,128}$/u.test(value.profileId)
  )
    return invalid();
  if (
    capabilities &&
    (value.profileId !== capabilities.profileId ||
      (value.thinking !== null && !capabilities.thinking))
  )
    return invalid();
  const parameters = object(value.parameters, [...Object.keys(ranges), 'stop']);
  const decoded = Object.fromEntries(
    Object.entries(ranges).map(([key, rule]) => [
      key,
      key === 'max_tokens' && parameters[key] === -1
        ? -1
        : number(
            parameters[key],
            rule[0],
            key === 'max_tokens' && capabilities ? capabilities.maxOutputTokens : rule[1],
            rule[2],
          ),
    ]),
  ) as unknown as Omit<NativeGenerationParameters, 'stop'>;
  return Object.freeze({
    modelId: value.modelId,
    profileId: value.profileId,
    activeLoadRevision: number(value.activeLoadRevision, 0, Number.MAX_SAFE_INTEGER, true),
    generationRevision: number(value.generationRevision, 0, Number.MAX_SAFE_INTEGER, true),
    contextLength: number(value.contextLength, 1, capabilities?.contextLimit ?? 2147483647, true),
    parameters: Object.freeze({ ...decoded, stop: strings(parameters.stop) }),
    systemPrompt: text(value.systemPrompt, 16000),
    thinking: value.thinking === null ? null : boolean(value.thinking),
    ...(Object.hasOwn(value, 'overflow')
      ? { overflow: value.overflow as AdvancedPreferences['overflow'] }
      : {}),
  });
}

/** Initialize from a trusted runtime profile, preserving its effective sampler behaviour. */
export function createModelConfiguration(
  modelId: string,
  load: LoadDefaults,
  capabilities: RuntimeSettingCapabilities,
): ModelConfigurationRecord {
  const native = capabilities.nativeDefaults;
  const option = (value: number, neutral: number): OptionalNumber => ({
    enabled: value !== neutral,
    value,
  });
  const inactive = (value: number): OptionalNumber => ({ enabled: false, value });
  return decodeModelConfiguration(
    {
      schemaVersion: 1,
      modelId,
      revision: 0,
      load,
      generation: {
        temperature: native.temperature,
        topK: native.top_k,
        topP: option(native.top_p, 1),
        minP: option(native.min_p, 0),
        repeatPenalty: option(native.repeat_penalty, 1),
        presencePenalty: option(native.presence_penalty, 0),
        seed: option(native.seed, 4294967295),
        responseLength: inactive(native.max_tokens),
        systemPrompt: '',
        thinking: null,
        stopStrings: [],
      },
      preferences: {
        reasoningBudget: inactive(8192),
        reasoningMessage: '',
        overflow: 'stop',
        ropeBase: inactive(10000),
        ropeScale: inactive(1),
        customTemplate: false,
        chatTemplate: '',
        argumentsEnabled: false,
        argumentsText: '',
      },
    },
    capabilities,
  );
}

/** Reject unknown native fields and non-finite values before any request or reservation exists. */
export function decodeGenerationOverrides(
  input: unknown,
  capabilities: RuntimeSettingCapabilities,
): GenerationOverrides {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return invalid();
  const value = input as Record<string, unknown>;
  const result: Record<string, number | readonly string[]> = {};
  for (const key of Object.keys(value)) {
    if (key === 'stop') {
      result.stop = strings(typeof value.stop === 'string' ? [value.stop] : value.stop);
      if (!result.stop.length) return invalid();
    } else {
      if (!Object.hasOwn(ranges, key)) return invalid();
      const rule = ranges[key as keyof typeof ranges];
      result[key] = number(
        value[key],
        rule[0],
        key === 'max_tokens' ? capabilities.maxOutputTokens : rule[1],
        rule[2],
      );
    }
  }
  return Object.freeze(result);
}

/** Decode a bounded versioned record; no native capability or executable argument is accepted. */
export function decodeModelConfiguration(
  input: unknown,
  capabilities: Pick<RuntimeSettingCapabilities, 'contextLimit'>,
): ModelConfigurationRecord {
  const value = object(input, [
    'schemaVersion',
    'modelId',
    'revision',
    'load',
    'generation',
    'preferences',
  ]);
  if (
    value.schemaVersion !== 1 ||
    typeof value.modelId !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(value.modelId)
  )
    return invalid();
  const load = object(value.load, [
    'automatic',
    'contextLength',
    'threads',
    'evaluationBatch',
    'physicalBatch',
    'concurrency',
    'flashAttention',
  ]);
  const generation = object(value.generation, [
    'temperature',
    'topK',
    'topP',
    'minP',
    'repeatPenalty',
    'presencePenalty',
    'seed',
    'responseLength',
    'systemPrompt',
    'thinking',
    'stopStrings',
  ]);
  const preferences = decodeAdvancedPreferences(value.preferences);
  const decoded: ModelConfigurationRecord = Object.freeze({
    schemaVersion: 1,
    modelId: value.modelId,
    revision: number(value.revision, 0, Number.MAX_SAFE_INTEGER, true),
    load: Object.freeze({
      automatic: boolean(load.automatic),
      contextLength: number(load.contextLength, 1, capabilities.contextLimit, true),
      threads: load.threads === null ? null : number(load.threads, 1, 1024, true),
      evaluationBatch: number(load.evaluationBatch, 1, 2147483647, true),
      physicalBatch: number(load.physicalBatch, 1, 2147483647, true),
      concurrency: number(load.concurrency, 1, 1024, true),
      flashAttention: boolean(load.flashAttention),
    }),
    generation: Object.freeze({
      temperature: number(generation.temperature, 0, 2),
      topK: number(generation.topK, 0, 2147483647, true),
      topP: optional(generation.topP, 0, 1),
      minP: optional(generation.minP, 0, 1),
      repeatPenalty: optional(generation.repeatPenalty, 0, 100),
      presencePenalty: optional(generation.presencePenalty, -2, 2),
      seed: optional(generation.seed, 0, 4294967295, true),
      responseLength: optional(generation.responseLength, 1, 2147483647, true),
      systemPrompt: text(generation.systemPrompt, 16000),
      thinking: generation.thinking === null ? null : boolean(generation.thinking),
      stopStrings: strings(generation.stopStrings),
    }),
    preferences,
  });
  if (
    decoded.load.physicalBatch > decoded.load.evaluationBatch ||
    new TextEncoder().encode(JSON.stringify(decoded)).byteLength > 65536
  )
    return invalid();
  return decoded;
}

/** Closed advanced settings data. Launch compilation separately rejects unsupported modes. */
export function decodeAdvancedPreferences(input: unknown): AdvancedPreferences {
  const preferences = object(input, [
    'reasoningBudget',
    'reasoningMessage',
    'overflow',
    'ropeBase',
    'ropeScale',
    'customTemplate',
    'chatTemplate',
    'argumentsEnabled',
    'argumentsText',
  ]);
  if (
    typeof preferences.overflow !== 'string' ||
    !['truncate-middle', 'stop', 'rolling'].includes(preferences.overflow)
  )
    return invalid();
  return Object.freeze({
    reasoningBudget: optional(preferences.reasoningBudget, 1, 2147483647, true),
    reasoningMessage: text(preferences.reasoningMessage, 4096),
    overflow: preferences.overflow as AdvancedPreferences['overflow'],
    ropeBase: optional(preferences.ropeBase, 1, 1e12),
    ropeScale: optional(preferences.ropeScale, 0.01, 1e6),
    customTemplate: boolean(preferences.customTemplate),
    chatTemplate: text(preferences.chatTemplate, 16000),
    argumentsEnabled: boolean(preferences.argumentsEnabled),
    argumentsText: text(preferences.argumentsText, 4096),
  });
}
