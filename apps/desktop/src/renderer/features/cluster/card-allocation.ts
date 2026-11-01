import type { SampleRange } from '../../mocks/cluster';

export interface AllocationSlot {
  hardwareId: string;
  first: number;
  count: number;
}

/** Execution follows layer order, never canvas geometry or device display names. */
export function allocationSlots(
  ids: readonly string[],
  ranges: readonly SampleRange[],
): AllocationSlot[] {
  const assigned = ids
    .flatMap((hardwareId) => {
      const range = ranges.find((item) => item.hardwareId === hardwareId);
      return range ? [{ hardwareId, first: range.first, count: range.last - range.first + 1 }] : [];
    })
    .sort((a, b) => a.first - b.first);
  const first = Math.max(0, ...assigned.map((slot) => slot.first + slot.count));
  return [
    ...assigned,
    ...ids
      .filter((id) => !assigned.some((slot) => slot.hardwareId === id))
      .map((hardwareId) => ({ hardwareId, first, count: 0 })),
  ];
}

/** Adjust one range and redistribute following GPUs, filling empty GPU slots from the remaining tail. */
export function resizeLayerEnd(
  slots: readonly AllocationSlot[],
  id: string,
  last: number,
  total: number,
  firstLayer?: number,
): SampleRange[] {
  const next = slots.map((slot) => ({ ...slot }));
  const index = next.findIndex((slot) => slot.hardwareId === id);
  const selected = next[index];
  if (!selected || (firstLayer ?? selected.first) >= total)
    return next
      .filter((slot) => slot.count > 0)
      .map(({ hardwareId, first, count }) => ({ hardwareId, first, last: first + count - 1 }));
  const previousEnd = selected.first + selected.count;
  selected.first = firstLayer ?? selected.first;
  const count = Math.max(selected.first, Math.min(total - 1, last)) - selected.first + 1;
  let growth = selected.first + count - previousEnd;
  selected.count = count;
  if (growth < 0 && next[index + 1]) next[index + 1]!.count -= growth;
  for (let i = index + 1; i < next.length && growth > 0; i++) {
    const take = Math.min(next[i]!.count, growth);
    next[i]!.count -= take;
    growth -= take;
  }
  let first = selected.first + selected.count;
  for (let i = index + 1; i < next.length; i++) {
    next[i]!.first = first;
    next[i]!.count = Math.min(next[i]!.count, Math.max(0, total - first));
    first += next[i]!.count;
  }
  const empty = next
    .slice(index + 1)
    .filter(
      (slot) =>
        slot.count === 0 &&
        slots.find((original) => original.hardwareId === slot.hardwareId)?.count === 0,
    );
  let remaining = Math.max(0, total - first);
  for (let i = 0; i < empty.length; i++) {
    const count = Math.ceil(remaining / (empty.length - i));
    empty[i]!.count = count;
    remaining -= count;
  }
  first = selected.first + selected.count;
  for (let i = index + 1; i < next.length; i++) {
    next[i]!.first = first;
    first += next[i]!.count;
  }
  return next
    .filter((slot) => slot.count > 0)
    .map(({ hardwareId, first, count }) => ({ hardwareId, first, last: first + count - 1 }));
}

export function allocationMessage(ranges: readonly SampleRange[], total: number): string {
  const ordered = [...ranges].sort((a, b) => a.first - b.first);
  let end = -1,
    assigned = 0,
    overlap = false;
  for (const range of ordered) {
    if (
      !Number.isInteger(range.first) ||
      !Number.isInteger(range.last) ||
      range.first < 0 ||
      range.last < range.first ||
      range.last >= total
    )
      return 'A range is outside the model layers. Edit the ranges before saving.';
    if (range.first <= end) overlap = true;
    assigned += Math.max(0, range.last - Math.max(end + 1, range.first) + 1);
    end = Math.max(end, range.last);
  }
  if (overlap)
    return 'Some layers are assigned to multiple GPUs. Edit the ranges to remove the overlap.';
  return assigned === total
    ? `All ${total} layers assigned`
    : `${assigned} of ${total} layers assigned · ${total - assigned} unassigned`;
}
