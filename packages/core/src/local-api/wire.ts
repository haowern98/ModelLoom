import type { ApiServerStatus } from './server.js';
import { decodeModelSource } from '../model-configuration/model-source.js';
import type { ModelSource } from '../model-configuration/model-source.js';
const actions = [
  'status',
  'start',
  'stop',
  'generateKey',
  'revealKey',
  'copyKey',
  'clearLogs',
] as const;
export type ApiManagementCommand = { readonly action: (typeof actions)[number] };
export type ApiOwnerCommand =
  | ApiManagementCommand
  | { readonly action: 'removeImport'; readonly modelId: string }
  | { readonly action: 'readLibraryEntry'; readonly after: string | null }
  | { readonly action: 'reinspectImport'; readonly modelId: string; readonly source: ModelSource }
  | {
      readonly action: 'registerImport' | 'registerCompanion';
      readonly modelId: string;
      readonly created: number;
      readonly source?: ModelSource;
    }
  | { readonly action: 'readImportSource' | 'readModelUsage' };
export type ApiManagementStatus = ApiServerStatus & {
  readonly keyPresent: boolean;
  readonly keyGeneration: number;
};
const errors = [
  'API_UNAVAILABLE',
  'CREDENTIAL_UNAVAILABLE',
  'ADDRESS_UNAVAILABLE',
  'RUNTIME_RECOVERY_REQUIRED',
  'NOT_READY',
  'INVALID_CONTROL',
  'CONFIGURATION_UNAVAILABLE',
] as const;
export type ApiManagementError = (typeof errors)[number];
export type ApiManagementReply =
  | { readonly ok: false; readonly error: ApiManagementError }
  | { readonly ok: true; readonly status: ApiManagementStatus; readonly secret?: string };
export interface ApiManagementBridge {
  command(input: ApiManagementCommand): Promise<ApiManagementReply>;
}
export type ApiOwnerReply =
  | ApiManagementReply
  | { readonly ok: true; readonly removed: true }
  | { readonly ok: true; readonly registered: true }
  | { readonly ok: true; readonly source: ModelSource | null }
  | {
      readonly ok: true;
      readonly entry: { readonly source: ModelSource; readonly lastUsedAt: number | null } | null;
    }
  | { readonly ok: true; readonly lastUsedAt: number | null };
export function decodeApiOwnerReply(input: unknown, command: ApiOwnerCommand): ApiOwnerReply {
  if (input && typeof input === 'object' && Reflect.get(input, 'ok') === false)
    return decodeApiManagementReply(input);
  if (command.action === 'removeImport') {
    const value = object(input, ['ok', 'removed']);
    if (value.ok !== true || value.removed !== true) return invalid();
    return Object.freeze({ ok: true, removed: true });
  }
  if (command.action === 'readLibraryEntry') {
    const value = object(input, ['ok', 'entry']);
    if (value.ok !== true) return invalid();
    if (value.entry === null) return Object.freeze({ ok: true, entry: null });
    const entry = object(value.entry, ['source', 'lastUsedAt']);
    const source = decodeModelSource(entry.source);
    if (
      (command.after !== null && source.modelId <= command.after) ||
      (entry.lastUsedAt !== null && integer(entry.lastUsedAt) < 1)
    )
      return invalid();
    return Object.freeze({
      ok: true,
      entry: Object.freeze({
        source,
        lastUsedAt: entry.lastUsedAt === null ? null : integer(entry.lastUsedAt),
      }),
    });
  }
  if (command.action === 'readModelUsage') {
    const value = object(input, ['ok', 'lastUsedAt']);
    if (value.ok !== true || (value.lastUsedAt !== null && integer(value.lastUsedAt) < 1))
      return invalid();
    return Object.freeze({
      ok: true,
      lastUsedAt: value.lastUsedAt === null ? null : integer(value.lastUsedAt),
    });
  }
  if (command.action === 'readImportSource') {
    const value = object(input, ['ok', 'source']);
    if (value.ok !== true) return invalid();
    return Object.freeze({
      ok: true,
      source: value.source === null ? null : decodeModelSource(value.source),
    });
  }
  if (
    command.action === 'registerImport' ||
    command.action === 'registerCompanion' ||
    command.action === 'reinspectImport'
  ) {
    const value = object(input, ['ok', 'registered']);
    if (value.ok !== true || value.registered !== true) return invalid();
    return Object.freeze({ ok: true, registered: true });
  }
  return decodeApiManagementReply(
    input,
    command.action === 'copyKey' || command.action === 'revealKey',
  );
}
function invalid(): never {
  throw new Error('INVALID_CONTROL');
}
function object(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return invalid();
  const value = input as Record<string, unknown>;
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key)))
    return invalid();
  return value;
}
function integer(input: unknown): number {
  return typeof input === 'number' && Number.isSafeInteger(input) && input >= 0 ? input : invalid();
}
function number(input: unknown): number | null {
  return input === null
    ? null
    : typeof input === 'number' &&
        Number.isFinite(input) &&
        input >= 0 &&
        input <= Number.MAX_SAFE_INTEGER
      ? input
      : invalid();
}
export function decodeApiManagementCommand(input: unknown): ApiManagementCommand {
  const value = object(input, ['action']);
  for (const action of actions) if (value.action === action) return Object.freeze({ action });
  return invalid();
}
/** Main-only import data is not admitted by the renderer bridge decoder. */
export function decodeApiOwnerCommand(input: unknown): ApiOwnerCommand {
  if (input && typeof input === 'object' && Reflect.get(input, 'action') === 'reinspectImport') {
    const value = object(input, ['action', 'modelId', 'source']);
    const source = decodeModelSource(value.source);
    if (source.modelId !== value.modelId || source.classificationVersion !== 1) return invalid();
    return Object.freeze({ action: 'reinspectImport', modelId: source.modelId, source });
  }
  if (input && typeof input === 'object' && Reflect.get(input, 'action') === 'removeImport') {
    const value = object(input, ['action', 'modelId']);
    if (typeof value.modelId !== 'string' || !/^[a-f0-9]{64}$/u.test(value.modelId))
      return invalid();
    return Object.freeze({ action: 'removeImport', modelId: value.modelId });
  }
  if (input && typeof input === 'object' && Reflect.get(input, 'action') === 'readLibraryEntry') {
    const value = object(input, ['action', 'after']);
    if (
      value.after !== null &&
      (typeof value.after !== 'string' || !/^[a-f0-9]{64}$/u.test(value.after))
    )
      return invalid();
    return Object.freeze({ action: 'readLibraryEntry', after: value.after });
  }
  if (input && typeof input === 'object' && Reflect.get(input, 'action') === 'readModelUsage') {
    object(input, ['action']);
    return Object.freeze({ action: 'readModelUsage' });
  }
  if (input && typeof input === 'object' && Reflect.get(input, 'action') === 'readImportSource') {
    object(input, ['action']);
    return Object.freeze({ action: 'readImportSource' });
  }
  if (
    input &&
    typeof input === 'object' &&
    (Reflect.get(input, 'action') === 'registerImport' ||
      Reflect.get(input, 'action') === 'registerCompanion')
  ) {
    const withSource = Object.hasOwn(input, 'source');
    const value = object(input, [
      'action',
      'modelId',
      'created',
      ...(withSource ? ['source'] : []),
    ]);
    if (
      typeof value.modelId !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(value.modelId) ||
      integer(value.created) < 1
    )
      return invalid();
    const source = withSource ? decodeModelSource(value.source) : undefined;
    if (source && source.modelId !== value.modelId) return invalid();
    if (value.action === 'registerCompanion' ? !source?.speculativeHead : source?.speculativeHead)
      return invalid();
    return Object.freeze({
      action: value.action as 'registerImport' | 'registerCompanion',
      modelId: value.modelId,
      created: integer(value.created),
      ...(source ? { source } : {}),
    });
  }
  return decodeApiManagementCommand(input);
}
/** Bounded projection. Copy's private transfer is stripped in main before returning to preload. */
export function decodeApiManagementReply(input: unknown, allowSecret = false): ApiManagementReply {
  try {
    if (new TextEncoder().encode(JSON.stringify(input)).byteLength > 131072) return invalid();
    if (!input || typeof input !== 'object') return invalid();
    const success = Reflect.get(input, 'ok') === true;
    const hasSecret = Object.hasOwn(input, 'secret');
    const value = object(
      input,
      success ? ['ok', 'status', ...(hasSecret ? ['secret'] : [])] : ['ok', 'error'],
    );
    if (!success) {
      if (value.ok !== false) return invalid();
      for (const error of errors)
        if (value.error === error) return Object.freeze({ ok: false, error });
      return invalid();
    }
    const status = object(value.status, [
      'phase',
      'configuredPort',
      'address',
      'model',
      'uptimeMs',
      'requests',
      'responseTimeMs',
      'logs',
      'error',
      'keyPresent',
      'keyGeneration',
    ]);
    const phase = status.phase;
    if (
      phase !== 'stopped' &&
      phase !== 'starting' &&
      phase !== 'running' &&
      phase !== 'stopping' &&
      phase !== 'failed'
    )
      return invalid();
    const configuredPort = integer(status.configuredPort);
    if (configuredPort > 65535) return invalid();
    const address = status.address;
    if (
      address !== null &&
      (typeof address !== 'string' ||
        !/^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}\/v1$/u.test(address) ||
        Number(address.split(':')[2]?.split('/')[0]) > 65535)
    )
      return invalid();
    if (phase === 'running' && address === null) return invalid();
    let model: ApiServerStatus['model'] = null;
    if (status.model !== null) {
      const value = object(status.model, ['id', 'created']);
      if (
        typeof value.id !== 'string' ||
        !/^[A-Za-z0-9_-]{1,128}$/u.test(value.id) ||
        integer(value.created) < 1
      )
        return invalid();
      model = Object.freeze({ id: value.id, created: integer(value.created) });
    }
    if (
      !Array.isArray(status.logs) ||
      status.logs.length > 500 ||
      status.logs.some(
        (line: unknown) =>
          typeof line !== 'string' ||
          line.length > 160 ||
          !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z (?:SERVER_STARTED|SERVER_STOPPED|SERVER_FAILED|REQUEST_COMPLETED|REQUEST_FAILED)(?: chatcmpl_[a-f0-9-]{36})?$/u.test(
            line,
          ),
      )
    )
      return invalid();
    const error = status.error;
    if (
      error !== null &&
      error !== 'CREDENTIAL_UNAVAILABLE' &&
      error !== 'ADDRESS_UNAVAILABLE' &&
      error !== 'RUNTIME_RECOVERY_REQUIRED'
    )
      return invalid();
    if (typeof status.keyPresent !== 'boolean') return invalid();
    if (
      hasSecret &&
      (!allowSecret || typeof value.secret !== 'string' || !/^ml_[a-f0-9]{64}$/u.test(value.secret))
    )
      return invalid();
    return Object.freeze({
      ok: true,
      status: Object.freeze({
        phase,
        configuredPort,
        address,
        model,
        uptimeMs: number(status.uptimeMs),
        requests: integer(status.requests),
        responseTimeMs: number(status.responseTimeMs),
        logs: Object.freeze(status.logs as string[]),
        error,
        keyPresent: status.keyPresent,
        keyGeneration: integer(status.keyGeneration),
      }),
      ...(hasSecret ? { secret: value.secret as string } : {}),
    });
  } catch {
    return invalid();
  }
}
