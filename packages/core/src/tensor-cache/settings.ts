import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { lstat, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { decodeCachePreferences, decodeCacheSettings } from './wire.js';
import type { CachePreferences, CacheSettings, CacheView } from './wire.js';

export interface CacheMaintenance {
  prepare(location: string): void;
  inspect(location: string): number;
  clear(location: string): number;
}
/** Loads a fixed local addon, never a renderer-specified library. */
export function cacheMaintenance(): CacheMaintenance {
  const binding: unknown = createRequire(import.meta.url)(
    fileURLToPath(new URL('../../out/native/tensor-cache.node', import.meta.url)),
  );
  if (
    !binding ||
    typeof binding !== 'object' ||
    ['prepare', 'inspect', 'clear'].some((key) => typeof Reflect.get(binding, key) !== 'function')
  )
    throw Error('CACHE_LOCATION_UNAVAILABLE');
  return binding as CacheMaintenance;
}
const defaults: CachePreferences = {
  enabled: true,
  limitGiB: 10,
  reserveGiB: 5,
  policy: 'replace',
};
/** Small atomic preferences file. Cache payloads stay in the independently
 * selected directory. Failed reads never silently reset an existing setting. */
export function createTensorCacheSettings(
  file: string,
  defaultLocation: string,
  supplied?: CacheMaintenance,
) {
  const maintenance = () => supplied ?? cacheMaintenance();
  let operations: Promise<unknown> = Promise.resolve();
  const serial = <T>(action: () => Promise<T>): Promise<T> => {
    const next = operations.catch(() => undefined).then(action);
    operations = next;
    return next;
  };
  async function load(): Promise<CacheSettings> {
    try {
      const metadata = await lstat(file);
      if (
        !metadata.isFile() ||
        metadata.isSymbolicLink() ||
        metadata.nlink !== 1 ||
        metadata.size > 4096
      )
        throw Error('CACHE_SETTINGS_UNAVAILABLE');
      const value: unknown = JSON.parse(await readFile(file, 'utf8'));
      if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        Object.keys(value).sort().join() !== 'settings,version' ||
        Reflect.get(value, 'version') !== 1
      )
        throw Error('CACHE_SETTINGS_UNAVAILABLE');
      const settings = decodeCacheSettings(Reflect.get(value, 'settings'));
      if (!path.isAbsolute(settings.location)) throw Error('CACHE_SETTINGS_UNAVAILABLE');
      return settings;
    } catch (error) {
      if (error && typeof error === 'object' && Reflect.get(error, 'code') === 'ENOENT')
        return { ...defaults, location: path.resolve(defaultLocation) };
      throw new Error('CACHE_SETTINGS_UNAVAILABLE', { cause: error });
    }
  }
  async function writeAtomic(target: string, value: unknown) {
    const parent = path.dirname(target);
    await mkdir(parent, { recursive: true, mode: 0o700 });
    if ((await lstat(parent)).isSymbolicLink()) throw Error('CACHE_SETTINGS_UNAVAILABLE');
    const temporary = `${target}.${randomUUID()}.tmp`;
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(JSON.stringify(value) + '\n');
      await handle.sync();
      await handle.close();
      await rename(temporary, target);
    } finally {
      await handle.close();
      await unlink(temporary).catch(() => undefined);
    }
  }
  const save = (settings: CacheSettings) => writeAtomic(file, { version: 1, settings });
  const statusFile = `${file}.status.json`;
  async function unavailable(location: string): Promise<boolean> {
    try {
      const metadata = await lstat(statusFile);
      if (
        !metadata.isFile() ||
        metadata.isSymbolicLink() ||
        metadata.nlink !== 1 ||
        metadata.size > 4096
      )
        return true;
      const value: unknown = JSON.parse(await readFile(statusFile, 'utf8'));
      if (
        !value ||
        typeof value !== 'object' ||
        Object.keys(value).sort().join() !== 'available,location,version' ||
        Reflect.get(value, 'version') !== 1 ||
        typeof Reflect.get(value, 'available') !== 'boolean' ||
        typeof Reflect.get(value, 'location') !== 'string'
      )
        return true;
      return (
        Reflect.get(value, 'location') === location && Reflect.get(value, 'available') === false
      );
    } catch (error) {
      return !error || typeof error !== 'object' || Reflect.get(error, 'code') !== 'ENOENT';
    }
  }
  async function view(): Promise<CacheView> {
    const settings = await load();
    try {
      if (!(await lstat(settings.location)).isDirectory())
        throw Error('CACHE_LOCATION_UNAVAILABLE');
      return {
        settings,
        usedBytes: maintenance().inspect(settings.location),
        ...((await unavailable(settings.location))
          ? { error: 'CACHE_LOCATION_UNAVAILABLE' as const }
          : {}),
      };
    } catch (error) {
      if (error && typeof error === 'object' && Reflect.get(error, 'code') === 'ENOENT')
        return {
          settings,
          usedBytes: 0,
          ...((await unavailable(settings.location))
            ? { error: 'CACHE_LOCATION_UNAVAILABLE' as const }
            : {}),
        };
      return {
        settings,
        usedBytes: null,
        error:
          error instanceof Error && error.message === 'CACHE_BUSY'
            ? 'CACHE_BUSY'
            : 'CACHE_LOCATION_UNAVAILABLE',
      };
    }
  }
  return {
    read: () => serial(view),
    /** Trusted core-only capture, not the renderer command surface. */
    capture: () => serial(load),
    /** Private worker-owner outcome; never accepts a renderer-reported status. */
    reportAvailability: (location: string, available: boolean) =>
      serial(() => writeAtomic(statusFile, { version: 1, location, available })),
    update: (input: CachePreferences) =>
      serial(async () => {
        const preferences = decodeCachePreferences(input);
        await save({ ...(await load()), ...preferences });
        return view();
      }),
    /** The caller supplies only a path returned by the native directory picker.
     * Changing location never moves/deletes the old cache or original models. */
    chooseLocation: (parent: string) =>
      serial(async () => {
        if (
          !path.isAbsolute(parent) ||
          parent.length > 950 ||
          [...parent].some((character) => character.charCodeAt(0) < 32)
        )
          throw Error('CACHE_LOCATION_UNAVAILABLE');
        const location = path.join(parent, 'ModelLoom-TensorCache-v1');
        await mkdir(location, { recursive: false, mode: 0o700 }).catch((error: unknown) => {
          if (!error || typeof error !== 'object' || Reflect.get(error, 'code') !== 'EEXIST')
            throw error;
        });
        maintenance().prepare(location);
        await save({ ...(await load()), location });
        return view();
      }),
    clear: () =>
      serial(async () => {
        const settings = await load();
        try {
          maintenance().clear(settings.location);
        } catch (error) {
          if (!error || typeof error !== 'object' || Reflect.get(error, 'code') !== 'ENOENT')
            throw error;
        }
        return view();
      }),
  };
}
