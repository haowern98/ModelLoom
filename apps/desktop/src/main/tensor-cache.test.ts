import { expect, it, vi } from 'vitest';
import { createCacheHandler } from './tensor-cache';

it('checks exact sender/frame and closed commands before reaching storage or the picker', async () => {
  const sender = {},
    frame = {},
    read = vi.fn(),
    pick = vi.fn();
  const handler = createCacheHandler({
    sender,
    frame: () => frame,
    closing: () => false,
    owner: () => ({ read, update: vi.fn(), chooseLocation: vi.fn(), clear: vi.fn() }),
    pick,
  });
  await expect(handler({ sender: {}, senderFrame: frame }, { action: 'read' })).rejects.toThrow(
    'INVALID_CONTROL',
  );
  await expect(handler({ sender, senderFrame: {} }, { action: 'read' })).rejects.toThrow(
    'INVALID_CONTROL',
  );
  await expect(
    handler({ sender, senderFrame: frame }, { action: 'choose-location', path: 'C:\\private' }),
  ).rejects.toThrow('INVALID_CONTROL');
  expect(read).not.toHaveBeenCalled();
  expect(pick).not.toHaveBeenCalled();
});
it('uses only the picker-selected path and bounds overlapping commands', async () => {
  const sender = {},
    frame = {};
  let resolve!: (path: string | null) => void;
  const pick = () =>
    new Promise<string | null>((done) => {
      resolve = done;
    });
  const view = {
    settings: {
      enabled: true,
      limitGiB: 10,
      reserveGiB: 5,
      policy: 'replace' as const,
      location: 'E:\\cache',
    },
    usedBytes: 0,
  };
  const owner = {
    read: vi.fn(() => Promise.resolve(view)),
    update: vi.fn(() => Promise.resolve(view)),
    chooseLocation: vi.fn(() => Promise.resolve(view)),
    clear: vi.fn(() => Promise.resolve(view)),
  };
  const handler = createCacheHandler({
    sender,
    frame: () => frame,
    closing: () => false,
    owner: () => owner,
    pick,
  });
  const event = { sender, senderFrame: frame };
  const pending = handler(event, { action: 'choose-location' });
  expect(await handler(event, { action: 'clear' })).toEqual({ ok: false, error: 'CACHE_BUSY' });
  resolve('E:\\Chosen');
  expect(await pending).toEqual({ ok: true, view });
  expect(owner.chooseLocation).toHaveBeenCalledWith('E:\\Chosen');
  expect(owner.clear).not.toHaveBeenCalled();
});
