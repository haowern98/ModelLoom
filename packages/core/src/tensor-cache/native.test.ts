import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { cacheMaintenance } from './settings.js';
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (path.dirname(root) !== path.resolve('out/test-temp')) throw Error('INVALID_TEST_ROOT');
    await rm(root, { recursive: true, force: true });
  }
});
async function folder() {
  await mkdir(path.resolve('out/test-temp'), { recursive: true });
  const root = await mkdtemp(path.resolve('out/test-temp/tensor-binding-'));
  roots.push(root);
  return root;
}

it('loads the maintenance ABI and clears only recognized cache files, preserving unrelated data', async () => {
  const root = await folder();
  const native = cacheMaintenance();
  native.prepare(root);
  const bytes = Buffer.from('same tensor bytes');
  const hash = createHash('sha256').update(bytes).digest('hex');
  await writeFile(path.join(root, `${hash}.tensor`), bytes);
  await writeFile(path.join(root, 'original.gguf'), 'original');
  expect(native.inspect(root)).toBe(bytes.length + 8);
  expect(native.clear(root)).toBe(8);
  expect(await readFile(path.join(root, 'original.gguf'), 'utf8')).toBe('original');
});
it('refuses to adopt a nonempty arbitrary directory as a managed cache', async () => {
  const root = await folder();
  await mkdir(path.join(root, 'models'));
  expect(() => cacheMaintenance().prepare(root)).toThrow('CACHE_LOCATION_UNAVAILABLE');
});
