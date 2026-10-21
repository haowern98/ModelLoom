import { expect, it } from 'vitest';
import { nativeContextSize } from './context.js';

it.each([
  [30246, 3, 30464, 91392],
  [10000, 3, 10240, 30720],
  [10240, 3, 10240, 30720],
  [1, 1, 256, 256],
  [257, 4, 512, 2048],
])(
  'resolves the pinned 256-token allocation for %i tokens and %i slots',
  (requested, slots, perSlot, total) => {
    expect(nativeContextSize(requested, slots)).toEqual({ perSlot, total });
  },
);
it.each([
  [0, 3],
  [1.5, 3],
  [10240, 0],
  [10240, 1.5],
  [2147483647, 1],
  [2147483392, 2],
])('rejects invalid or overflowing native allocation %j/%j', (requested, slots) => {
  expect(() => nativeContextSize(requested, slots)).toThrow('INVALID_CONFIGURATION');
});
