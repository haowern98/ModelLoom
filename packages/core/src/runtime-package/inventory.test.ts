import { expect, it } from 'vitest';
import { parseInventory } from './inventory.js';

import { inventory } from '../../tests/inventory-fixture.js';
it('accepts an explicitly declared Vulkan inventory, not an unknown GPU backend', () => {
  expect(parseInventory({ ...inventory, backend: 'vulkan', minimumDriver: '551.78' }).backend).toBe(
    'vulkan',
  );
  expect(() => parseInventory({ ...inventory, backend: 'metal' })).toThrow('INVALID_INVENTORY');
});
it('accepts a complete supported signed inventory without retaining caller mutation', () => {
  const input = structuredClone(inventory);
  const parsed = parseInventory(input);
  input.files[0]!.path = 'evil.exe';
  expect(parsed).toEqual(inventory);
  expect(Object.isFrozen(parsed)).toBe(true);
});
it.each([
  '../escape.exe',
  '/root.exe',
  'C:/escape.exe',
  '\\\\host\\escape.exe',
  'file:stream',
  'sub\\x.exe',
  'CON',
  'x.exe.',
  'x.exe ',
  'a//b',
  './x.exe',
])('rejects unsafe Windows package path %s', (path) => {
  expect(() => parseInventory({ ...inventory, files: [{ ...inventory.files[0], path }] })).toThrow(
    'INVALID_INVENTORY',
  );
});
it('rejects dependency aliases that collide on Windows', () => {
  expect(() =>
    parseInventory({
      ...inventory,
      files: [...inventory.files, { ...inventory.files[0], path: 'LLAMA-SERVER.EXE' }],
    }),
  ).toThrow('INVALID_INVENTORY');
});
it.each([
  { arch: 'arm64' },
  { platform: 'linux' },
  { protocol: 2 },
  { backend: 'cuda', minimumDriver: null },
  { stop: 'http' },
  { files: [] },
  { arbitraryArgs: ['--shell'] },
  { files: Array.from({ length: 257 }, () => inventory.files[0]) },
  { files: [{ ...inventory.files[0], length: 8 * 1024 ** 3 + 1 }] },
  { files: [{ ...inventory.files[0], sha256: 'bad' }] },
])('rejects unsupported or incomplete inventory %j', (change) => {
  expect(() => parseInventory({ ...inventory, ...change })).toThrow('INVALID_INVENTORY');
});
