/** Pinned b11306 non-unified KV allocation, independent of saved user preferences. */
export function nativeContextSize(
  requested: number,
  slots: number,
): {
  readonly perSlot: number;
  readonly total: number;
} {
  const perSlot = Math.ceil(requested / 256) * 256;
  const total = perSlot * slots;
  if (
    !Number.isSafeInteger(requested) ||
    requested < 1 ||
    !Number.isSafeInteger(slots) ||
    slots < 1 ||
    !Number.isSafeInteger(total) ||
    total > 2147483647
  )
    throw Error('INVALID_CONFIGURATION');
  return { perSlot, total };
}
