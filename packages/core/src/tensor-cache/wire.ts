/** Device-local weight cache preferences. GiB means 2^30 bytes. Location is
 * displayed to the renderer but can only be changed through the native picker. */
export interface CachePreferences {
  readonly enabled: boolean;
  readonly limitGiB: number;
  readonly reserveGiB: number;
  readonly policy: 'replace' | 'keep';
}
export interface CacheSettings extends CachePreferences {
  readonly location: string;
}
export interface CacheView {
  readonly settings: CacheSettings;
  readonly usedBytes: number | null;
  readonly error?: 'CACHE_BUSY' | 'CACHE_LOCATION_UNAVAILABLE';
}
export type CacheCommand =
  | Readonly<{ action: 'read' | 'choose-location' | 'clear' }>
  | Readonly<{ action: 'set'; settings: CachePreferences }>;
export type CacheReply =
  | Readonly<{ ok: true; view: CacheView }>
  | Readonly<{
      ok: false;
      error: 'CACHE_SETTINGS_UNAVAILABLE' | 'CACHE_BUSY' | 'CACHE_LOCATION_UNAVAILABLE';
    }>;
export interface CacheBridge {
  command(input: CacheCommand): Promise<CacheReply>;
}

const invalid = (): never => {
  throw Error('INVALID_CONTROL');
};
function object(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return invalid();
  return input as Record<string, unknown>;
}
function keys(v: Record<string, unknown>, expected: readonly string[]) {
  if (Object.keys(v).length !== expected.length || expected.some((key) => !Object.hasOwn(v, key)))
    invalid();
}
/** Closed boundary decoder; paths and native options are never accepted here. */
export function decodeCachePreferences(input: unknown): CachePreferences {
  const v = object(input);
  keys(v, ['enabled', 'limitGiB', 'reserveGiB', 'policy']);
  if (
    typeof v.enabled !== 'boolean' ||
    !Number.isSafeInteger(v.limitGiB) ||
    (v.limitGiB as number) < 1 ||
    (v.limitGiB as number) > 1048576 ||
    !Number.isSafeInteger(v.reserveGiB) ||
    (v.reserveGiB as number) < 1 ||
    (v.reserveGiB as number) > 1048576 ||
    (v.policy !== 'replace' && v.policy !== 'keep')
  )
    return invalid();
  return {
    enabled: v.enabled,
    limitGiB: v.limitGiB as number,
    reserveGiB: v.reserveGiB as number,
    policy: v.policy,
  };
}
export function decodeCacheCommand(input: unknown): CacheCommand {
  const v = object(input);
  if (v.action === 'set') {
    keys(v, ['action', 'settings']);
    return { action: 'set', settings: decodeCachePreferences(v.settings) };
  }
  keys(v, ['action']);
  if (v.action !== 'read' && v.action !== 'choose-location' && v.action !== 'clear')
    return invalid();
  return { action: v.action };
}
export function decodeCacheSettings(input: unknown): CacheSettings {
  const v = object(input);
  keys(v, ['enabled', 'limitGiB', 'reserveGiB', 'policy', 'location']);
  const { location, ...preferences } = v;
  if (
    typeof location !== 'string' ||
    !location.length ||
    location.length > 1024 ||
    [...location].some((character) => character.charCodeAt(0) < 32)
  )
    return invalid();
  return { ...decodeCachePreferences(preferences), location };
}
export function decodeCacheReply(input: unknown): CacheReply {
  const v = object(input);
  if (v.ok === false) {
    keys(v, ['ok', 'error']);
    if (
      !['CACHE_SETTINGS_UNAVAILABLE', 'CACHE_BUSY', 'CACHE_LOCATION_UNAVAILABLE'].includes(
        String(v.error),
      )
    )
      return invalid();
    return { ok: false, error: v.error as Extract<CacheReply, { ok: false }>['error'] };
  }
  if (v.ok !== true) return invalid();
  keys(v, ['ok', 'view']);
  const view = object(v.view);
  keys(view, ['settings', 'usedBytes', ...(Object.hasOwn(view, 'error') ? ['error'] : [])]);
  if (
    view.usedBytes !== null &&
    (!Number.isSafeInteger(view.usedBytes) || (view.usedBytes as number) < 0)
  )
    return invalid();
  if (
    Object.hasOwn(view, 'error') &&
    view.error !== 'CACHE_BUSY' &&
    view.error !== 'CACHE_LOCATION_UNAVAILABLE'
  )
    return invalid();
  return {
    ok: true,
    view: {
      settings: decodeCacheSettings(view.settings),
      usedBytes: view.usedBytes as number | null,
      ...(view.error ? { error: view.error as NonNullable<CacheView['error']> } : {}),
    },
  };
}
