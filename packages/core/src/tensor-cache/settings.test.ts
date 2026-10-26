import { afterEach, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { createTensorCacheSettings } from './settings.js';
import { decodeCacheCommand } from './wire.js';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (path.dirname(root) !== path.resolve('out/test-temp')) throw Error('INVALID_TEST_ROOT');
    await rm(root, { recursive: true, force: true });
  }
});
async function setup() {
  await mkdir(path.resolve('out/test-temp'), { recursive: true });
  const folder = await mkdtemp(path.resolve('out/test-temp/tensor-settings-'));
  roots.push(folder);
  const file = path.join(folder, 'settings.json');
  const cache = path.join(folder, 'cache');
  const native = { prepare: () => {}, inspect: () => 0, clear: () => 0 };
  return { folder, file, cache, owner: createTensorCacheSettings(file, cache, native), native };
}
it('defaults on with independent per-PC disk limits and persists explicit choices', async () => {
  const { owner, file, cache, native } = await setup();
  expect((await owner.read()).settings).toEqual({
    enabled: true,
    limitGiB: 10,
    reserveGiB: 5,
    policy: 'replace',
    location: cache,
  });
  await owner.update({ enabled: false, limitGiB: 22, reserveGiB: 7, policy: 'keep' });
  const next = createTensorCacheSettings(file, cache, native);
  expect((await next.read()).settings).toMatchObject({
    enabled: false,
    limitGiB: 22,
    reserveGiB: 7,
    policy: 'keep',
  });
  const saved: unknown = JSON.parse(await readFile(file, 'utf8'));
  expect(saved).toMatchObject({ version: 1 });
});
it('rejects arbitrary paths, unknown fields and invalid limits at the renderer boundary', () => {
  for (const command of [
    { action: 'read', path: 'C:\\private' },
    { action: 'set', settings: { enabled: true, limitGiB: 0, reserveGiB: 5, policy: 'replace' } },
    { action: 'set', settings: { enabled: true, limitGiB: 10, reserveGiB: 5, policy: 'anything' } },
    {
      action: 'set',
      settings: {
        enabled: true,
        limitGiB: 10,
        reserveGiB: 5,
        policy: 'replace',
        location: 'C:\\private',
      },
    },
  ])
    expect(() => decodeCacheCommand(command)).toThrow('INVALID_CONTROL');
});
it('does not silently overwrite malformed persisted settings with defaults', async () => {
  const { owner, file } = await setup();
  await writeFile(file, '{broken');
  await expect(owner.read()).rejects.toThrow('CACHE_SETTINGS_UNAVAILABLE');
  expect(await readFile(file, 'utf8')).toBe('{broken');
});
it('stores the chosen dedicated location without moving or deleting the old one', async () => {
  const { owner, folder, cache } = await setup();
  await owner.chooseLocation(folder);
  expect((await owner.read()).settings.location).toBe(
    path.join(folder, 'ModelLoom-TensorCache-v1'),
  );
  expect((await owner.read()).settings.location).not.toBe(cache);
});

it('reports worker cache setup failures across owners and clears them after recovery', async () => {
  const { owner, file, cache, native } = await setup();
  await mkdir(cache);
  await owner.reportAvailability(cache, false);
  const reader = createTensorCacheSettings(file, cache, native);
  expect(await reader.read()).toMatchObject({ error: 'CACHE_LOCATION_UNAVAILABLE' });
  await owner.reportAvailability(cache, true);
  expect((await reader.read()).error).toBeUndefined();
  await owner.reportAvailability(cache, false);
  await owner.chooseLocation(path.dirname(cache));
  expect((await reader.read()).error).toBeUndefined();
});

it('shows a known worker setup failure even when the cache directory is missing', async () => {
  const { owner, cache } = await setup();
  await owner.reportAvailability(cache, false);
  expect(await owner.read()).toMatchObject({ usedBytes: 0, error: 'CACHE_LOCATION_UNAVAILABLE' });
});
