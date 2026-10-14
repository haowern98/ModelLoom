import { test } from 'node:test';
import assert from 'node:assert/strict';
import { link, mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const build = require('esbuild').build;

test('bundled live entry has no fixture launcher or publisher implementation', async () => {
  const result = await build({
    entryPoints: ['../../packages/core/out/hosts/development-desktop.js'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    metafile: true,
  });
  const retained = Object.values(result.metafile.outputs)
    .flatMap((output) => Object.entries(output.inputs))
    .filter(([, info]) => info.bytesInOutput > 0)
    .map(([file]) => file);
  assert.equal(
    retained.some((file) => /fixture-engine|publisher/.test(file)),
    false,
  );
});

test('staging rejects changed signed inputs and never overwrites an existing output', async () => {
  const { stageDevelopment } = await import('./stage-development.mjs');
  const root = await mkdtemp(path.resolve('out/stage-test-'));
  const candidate = path.join(root, 'candidate');
  await mkdir(candidate);
  await writeFile(path.join(candidate, 'llama-server.exe'), 'changed');
  await assert.rejects(
    stageDevelopment(path.join(root, 'stage'), candidate),
    /INVALID_RUNTIME_TREE|FILE_MISMATCH/,
  );
  const existing = path.join(root, 'existing');
  await mkdir(existing);
  await writeFile(path.join(existing, 'keep.txt'), 'keep');
  await assert.rejects(stageDevelopment(existing), /EEXIST/);
  assert.equal(await readFile(path.join(existing, 'keep.txt'), 'utf8'), 'keep');
});

test('staging checks file bytes even when the complete runtime tree is present', async () => {
  const { stageDevelopment } = await import('./stage-development.mjs');
  const root = await mkdtemp(path.resolve('out/stage-bytes-test-'));
  if (!root.startsWith(path.resolve('out') + path.sep)) throw new Error('Unsafe test cleanup');
  const candidate = path.join(root, 'candidate');
  await mkdir(candidate);
  const source = path.resolve('../../packages/core/out/activation/b11306/candidate');
  const inventory = JSON.parse(
    await readFile('../../packages/core/out/activation/b11306/repository/inventory.json', 'utf8'),
  );
  try {
    for (const file of inventory.files)
      await link(path.join(source, file.path), path.join(candidate, file.path));
    // Replace only our first link; never change bytes through a shared signed-input link.
    const altered = path.join(candidate, inventory.files[0].path);
    await unlink(altered);
    await writeFile(altered, 'altered');
    await assert.rejects(stageDevelopment(path.join(root, 'stage'), candidate), /FILE_MISMATCH/);
  } finally {
    await rm(root, { recursive: true });
  }
});
