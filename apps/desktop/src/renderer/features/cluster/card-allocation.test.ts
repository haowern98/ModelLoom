import { expect, it } from 'vitest';
import { allocationSlots, resizeLayerEnd, allocationMessage } from './card-allocation';

it('orders participating GPUs by layer order across devices, keeping empty GPUs last', () => {
  expect(
    allocationSlots(
      ['remote', 'empty', 'local'],
      [
        { hardwareId: 'local', first: 0, last: 21 },
        { hardwareId: 'remote', first: 22, last: 63 },
      ],
    ),
  ).toEqual([
    { hardwareId: 'local', first: 0, count: 22 },
    { hardwareId: 'remote', first: 22, count: 42 },
    { hardwareId: 'empty', first: 64, count: 0 },
  ]);
});
it('resizes the endpoint and shifts remote ranges without mutating the original draft', () => {
  const slots = [
    { hardwareId: 'a', first: 0, count: 22 },
    { hardwareId: 'b', first: 22, count: 21 },
    { hardwareId: 'peer:gpu', first: 43, count: 21 },
  ];
  expect(resizeLayerEnd(slots, 'b', 56, 64)).toEqual([
    { hardwareId: 'a', first: 0, last: 21 },
    { hardwareId: 'b', first: 22, last: 56 },
    { hardwareId: 'peer:gpu', first: 57, last: 63 },
  ]);
  expect(slots[2]?.first).toBe(43);
  expect(resizeLayerEnd(slots, 'a', 49, 64)).toEqual([
    { hardwareId: 'a', first: 0, last: 49 },
    { hardwareId: 'peer:gpu', first: 50, last: 63 },
  ]);
});
it('keeps every endpoint inside odd-sized models across 2–8 GPUs', () => {
  const total = 113;
  for (let size = 2; size <= 8; size++) {
    let first = 0;
    const slots = Array.from({ length: size }, (_, index) => {
      const count = Math.floor(total / size) + (index < total % size ? 1 : 0);
      const slot = { hardwareId: String(index), first, count };
      first += count;
      return slot;
    });
    for (const slot of slots)
      for (let end = slot.first; end < total; end++) {
        const next = resizeLayerEnd(slots, slot.hardwareId, end, total);
        const edited = next.find((item) => item.hardwareId === slot.hardwareId)!;
        expect([edited.first, edited.last]).toEqual([slot.first, end]);
        expect(next.every((item) => item.first >= 0 && item.last < total)).toBe(true);
        expect(allocationMessage(next, total)).not.toMatch(/overlap/);
      }
  }
});
it('reports overlaps and tails without negative counts, including malformed manual ranges', () => {
  expect(
    allocationMessage(
      [
        { hardwareId: 'a', first: 0, last: 30 },
        { hardwareId: 'b', first: 22, last: 63 },
      ],
      64,
    ),
  ).toMatch(/multiple GPUs/);
  expect(allocationMessage([{ hardwareId: 'a', first: 0, last: 56 }], 64)).toMatch(/7 unassigned/);
  expect(allocationMessage([{ hardwareId: 'a', first: 0, last: 89 }], 64)).toMatch(/outside/);
});

it('fills initially empty followers without gaps or overlaps across 2-16 GPUs', () => {
  for (const total of [64, 113])
    for (let count = 2; count <= 16; count++) {
      const ids = Array.from({ length: count }, (_, i) => `gpu-${i}`);
      for (const last of [0, 10, 38, total - 1]) {
        const next = resizeLayerEnd(allocationSlots(ids, []), ids[0]!, last, total);
        expect(next[0]).toEqual({ hardwareId: ids[0], first: 0, last });
        expect(allocationMessage(next, total)).toBe(`All ${total} layers assigned`);
        expect(next.every((range) => range.first <= range.last)).toBe(true);
      }
    }
});
