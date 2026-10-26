import { decodeCacheCommand, decodeCacheReply } from '../shared/tensor-cache';
import type { CachePreferences, CacheView, CacheReply } from '../shared/tensor-cache';

interface CacheOwner {
  read(): Promise<CacheView>;
  update(settings: CachePreferences): Promise<CacheView>;
  chooseLocation(parent: string): Promise<CacheView>;
  clear(): Promise<CacheView>;
}
/** Exact-frame local management only. Directory paths come exclusively from
 * the native picker, and at most one storage operation/dialog is admitted. */
export function createCacheHandler(options: {
  sender: object;
  frame(): object;
  closing(): boolean;
  owner(): CacheOwner | undefined;
  pick(): Promise<string | null>;
}) {
  let busy = false;
  return async (
    event: { sender: object; senderFrame: object | null },
    input: unknown,
  ): Promise<CacheReply> => {
    if (
      event.sender !== options.sender ||
      event.senderFrame !== options.frame() ||
      options.closing()
    )
      throw Error('INVALID_CONTROL');
    const command = decodeCacheCommand(input);
    if (busy) return { ok: false, error: 'CACHE_BUSY' };
    const owner = options.owner();
    if (!owner) return { ok: false, error: 'CACHE_SETTINGS_UNAVAILABLE' };
    busy = true;
    try {
      let view: CacheView;
      if (command.action === 'set') view = await owner.update(command.settings);
      else if (command.action === 'clear') view = await owner.clear();
      else if (command.action === 'choose-location') {
        const selected = await options.pick();
        if (options.closing()) throw Error('CACHE_SETTINGS_UNAVAILABLE');
        view = selected === null ? await owner.read() : await owner.chooseLocation(selected);
      } else view = await owner.read();
      return decodeCacheReply({ ok: true, view });
    } catch (error) {
      return decodeCacheReply({
        ok: false,
        error:
          error instanceof Error &&
          ['CACHE_BUSY', 'CACHE_LOCATION_UNAVAILABLE'].includes(error.message)
            ? error.message
            : 'CACHE_SETTINGS_UNAVAILABLE',
      });
    } finally {
      busy = false;
    }
  };
}
