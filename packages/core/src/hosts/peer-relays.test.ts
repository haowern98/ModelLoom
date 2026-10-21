import { expect, it } from 'vitest';
import { createPeerRelays } from './peer-relays.js';

it('never launches remote placement without its trusted peer owner', async () => {
  await expect(
    createPeerRelays(
      [`peer:${'a'.repeat(64)}:GPU-11111111-1111-1111-1111-111111111111`],
      () => false,
    ),
  ).rejects.toThrow('RPC_PACKAGE_REQUIRED');
  const local = await createPeerRelays(['GPU-11111111-1111-1111-1111-111111111111'], () => false);
  expect(local.arguments).toEqual([]);
  expect(local.physical).toEqual([]);
  await local.close();
});
