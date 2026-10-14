import { decodeModelConfiguration } from './contracts.js';
import type { ModelConfigurationRecord } from './contracts.js';

/** Data-only management operations; caller and imported-model authority are supplied by hosts. */
export type ConfigurationCommand =
  | { readonly action: 'read'; readonly modelId: string }
  | {
      readonly action: 'save';
      readonly modelId: string;
      readonly expectedRevision: number;
      readonly record: ModelConfigurationRecord;
    };
const errors = [
  'UNKNOWN_MODEL',
  'STALE_CONFIGURATION',
  'INVALID_CONFIGURATION',
  'UNSUPPORTED_CONFIGURATION',
  'UNSUPPORTED_SETTING',
  'CONFIGURATION_UNAVAILABLE',
  'NOT_READY',
] as const;
export type ConfigurationError = (typeof errors)[number];
/** No endpoint, native handle, storage path or secret crosses this management reply. */
export type ConfigurationReply =
  | { readonly ok: false; readonly error: ConfigurationError }
  | {
      readonly ok: true;
      readonly record: ModelConfigurationRecord;
      readonly defaults: ModelConfigurationRecord;
      readonly pendingReload: boolean;
      readonly maxOutputTokens: number;
      readonly thinkingSupported: boolean;
    };
export interface ConfigurationBridge {
  command(input: ConfigurationCommand): Promise<ConfigurationReply>;
}

function object(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('INVALID_CONTROL');
  const value = input as Record<string, unknown>;
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key)))
    throw Error('INVALID_CONTROL');
  return value;
}
function bounded<T>(input: unknown, decode: () => T): T {
  try {
    if (new TextEncoder().encode(JSON.stringify(input)).byteLength > 131072)
      throw Error('INVALID_CONTROL');
    return decode();
  } catch {
    throw Error('INVALID_CONTROL');
  }
}
const syntax = { contextLimit: 2147483647 };

/** Validate framing/schema only. Main and core independently check actual model ownership/profile. */
export function decodeConfigurationCommand(input: unknown): ConfigurationCommand {
  return bounded(input, () => {
    const action: unknown =
      input && typeof input === 'object' ? Reflect.get(input, 'action') : undefined;
    const value = object(
      input,
      action === 'save'
        ? ['action', 'modelId', 'expectedRevision', 'record']
        : ['action', 'modelId'],
    );
    if (typeof value.modelId !== 'string' || !/^[a-f0-9]{64}$/u.test(value.modelId))
      throw Error('INVALID_CONTROL');
    if (action === 'read') return Object.freeze({ action, modelId: value.modelId });
    if (action !== 'save') throw Error('INVALID_CONTROL');
    const record = decodeModelConfiguration(value.record, syntax);
    if (record.modelId !== value.modelId || record.revision !== value.expectedRevision)
      throw Error('INVALID_CONTROL');
    return Object.freeze({
      action,
      modelId: value.modelId,
      expectedRevision: record.revision,
      record,
    });
  });
}

/** Reject raw host exceptions and privileged additions before delivering renderer state. */
export function decodeConfigurationReply(input: unknown): ConfigurationReply {
  return bounded(input, () => {
    const success = input && typeof input === 'object' && Reflect.get(input, 'ok') === true;
    const value = object(
      input,
      success
        ? ['ok', 'record', 'defaults', 'pendingReload', 'maxOutputTokens', 'thinkingSupported']
        : ['ok', 'error'],
    );
    if (!success) {
      if (value.ok !== false) throw Error('INVALID_CONTROL');
      for (const error of errors)
        if (value.error === error) return Object.freeze({ ok: false, error });
      throw Error('INVALID_CONTROL');
    }
    const record = decodeModelConfiguration(value.record, syntax),
      defaults = decodeModelConfiguration(value.defaults, syntax);
    if (
      record.modelId !== defaults.modelId ||
      defaults.revision !== 0 ||
      typeof value.pendingReload !== 'boolean' ||
      typeof value.thinkingSupported !== 'boolean' ||
      typeof value.maxOutputTokens !== 'number' ||
      !Number.isSafeInteger(value.maxOutputTokens) ||
      value.maxOutputTokens < 1 ||
      value.maxOutputTokens > 2147483647
    )
      throw Error('INVALID_CONTROL');
    return Object.freeze({
      ok: true,
      record,
      defaults,
      pendingReload: value.pendingReload,
      maxOutputTokens: value.maxOutputTokens,
      thinkingSupported: value.thinkingSupported,
    });
  });
}
