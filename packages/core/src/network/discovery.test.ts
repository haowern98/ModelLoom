import { expect, it, vi } from 'vitest';
import { TailnetDiscovery } from './discovery.js';
it('caps concurrent probes, coalesces refresh and does not transfer trust from advertisements', async () => {
  let active = 0,
    peak = 0;
  const probe = vi.fn(async (address: string) => {
    active++;
    peak = Math.max(active, peak);
    await new Promise((resolve) => setTimeout(resolve, 1));
    active--;
    return { protocol: 1, name: address, fingerprint: 'a'.repeat(64), sharing: true };
  });
  const discovery = new TailnetDiscovery(probe, () => undefined);
  const peers = Array.from({ length: 13 }, (_, n) => ({
    id: String(n),
    address: `100.90.40.${n + 1}`,
    name: 'PC',
    online: true,
  }));
  await Promise.all([discovery.update(peers), discovery.update(peers)]);
  expect(peak).toBeLessThanOrEqual(4);
  expect(probe).toHaveBeenCalledTimes(13);
  expect(discovery.view()).toHaveLength(1);
  await discovery.update(peers);
  expect(probe).toHaveBeenCalledTimes(13);
  await discovery.update([]);
  expect(discovery.view()).toEqual([]);
});
it('ignores stale replies after disconnect and rejects inventory-bearing advertisements', async () => {
  let finish!: (value: unknown) => void;
  const discovery = new TailnetDiscovery(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
    () => undefined,
  );
  const updating = discovery.update([
    { id: 'one', address: '100.90.40.12', name: 'PC', online: true },
  ]);
  discovery.clear();
  finish({ protocol: 1, name: 'PC', fingerprint: 'b'.repeat(64), sharing: true, gpus: [] });
  await updating;
  expect(discovery.view()).toEqual([]);
});
