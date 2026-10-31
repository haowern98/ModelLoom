export const RUNTIME_LOG_LIMITS = Object.freeze({ entries: 2048, bytes: 524288, message: 4096 });
export const runtimeLogSources = [
  'app',
  'runtime',
  'core',
  'peer',
  'worker',
  'chat',
  'api',
] as const;
export type RuntimeLogSource = (typeof runtimeLogSources)[number];
export interface RuntimeLogEntry {
  readonly id: number;
  readonly at: string;
  readonly source: RuntimeLogSource;
  readonly level: 'info' | 'error';
  readonly message: string;
}
export type RuntimeLogCommand =
  { readonly action: 'read'; readonly after?: number } | { readonly action: 'clear' };
export type RuntimeLogSnapshot = {
  readonly ok: true;
  readonly revision: number;
  readonly entries: readonly RuntimeLogEntry[] | null;
};
export type RuntimeLogReply =
  RuntimeLogSnapshot | { readonly ok: false; readonly error: 'NOT_READY' };
export interface RuntimeLogsBridge {
  command(input: RuntimeLogCommand): Promise<RuntimeLogReply>;
}
function invalid(): never {
  throw Error('INVALID_CONTROL');
}
function object(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).length !== keys.length ||
    Object.keys(input).some((key) => !keys.includes(key))
  )
    invalid();
  return input as Record<string, unknown>;
}
const integer = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
export function decodeRuntimeLogCommand(input: unknown): RuntimeLogCommand {
  const value = object(
    input,
    input && typeof input === 'object' && Object.hasOwn(input, 'after')
      ? ['action', 'after']
      : ['action'],
  );
  if (value.action === 'clear' && !Object.hasOwn(value, 'after'))
    return Object.freeze({ action: 'clear' });
  if (value.action !== 'read' || (Object.hasOwn(value, 'after') && !integer(value.after)))
    invalid();
  return Object.freeze({
    action: 'read',
    ...(value.after === undefined ? {} : { after: value.after as number }),
  });
}
export function decodeRuntimeLogReply(input: unknown): RuntimeLogReply {
  const ok = input && typeof input === 'object' && Reflect.get(input, 'ok') === true;
  const value = object(input, ok ? ['ok', 'revision', 'entries'] : ['ok', 'error']);
  if (!ok) {
    if (value.ok !== false || value.error !== 'NOT_READY') invalid();
    return Object.freeze({ ok: false, error: 'NOT_READY' });
  }
  if (!integer(value.revision)) invalid();
  if (value.entries === null)
    return Object.freeze({ ok: true, revision: value.revision, entries: null });
  if (!Array.isArray(value.entries) || value.entries.length > RUNTIME_LOG_LIMITS.entries) invalid();
  let previous = 0;
  const entries = value.entries.map((input: unknown): RuntimeLogEntry => {
    const entry = object(input, ['id', 'at', 'source', 'level', 'message']);
    if (
      !integer(entry.id) ||
      entry.id <= previous ||
      entry.id > (value.revision as number) ||
      typeof entry.at !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(entry.at) ||
      typeof entry.source !== 'string' ||
      !runtimeLogSources.some((source) => source === entry.source) ||
      (entry.level !== 'info' && entry.level !== 'error') ||
      typeof entry.message !== 'string' ||
      entry.message.length > RUNTIME_LOG_LIMITS.message ||
      /\p{Cc}/u.test(entry.message)
    )
      invalid();
    previous = entry.id;
    return Object.freeze({
      id: entry.id,
      at: entry.at,
      source: entry.source as RuntimeLogSource,
      level: entry.level,
      message: entry.message,
    });
  });
  if (new TextEncoder().encode(JSON.stringify(entries)).byteLength > RUNTIME_LOG_LIMITS.bytes)
    invalid();
  return Object.freeze({ ok: true, revision: value.revision, entries: Object.freeze(entries) });
}
