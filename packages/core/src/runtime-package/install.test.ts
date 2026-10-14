import { afterEach, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  link,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { repository } from '../../tests/package-repository.js';
import { inventory } from '../../tests/inventory-fixture.js';
import { createFixtureVerifier } from './verifier.js';
import { installExpanded, revalidateInstalled, requireInstalledLive } from './install.js';
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function setup() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'modelloom-install-'));
  dirs.push(dir);
  const bundle = path.join(dir, 'bundle'),
    root = path.join(dir, 'managed'),
    repo = path.join(dir, 'repo');
  await mkdir(bundle);
  const first = Buffer.from('exe'),
    second = Buffer.from('host');
  const description = {
    ...inventory,
    files: [
      {
        path: 'llama-server.exe',
        length: 3,
        sha256: createHash('sha256').update(first).digest('hex'),
      },
      {
        path: 'ModelLoom-runtime-host.exe',
        length: 4,
        sha256: createHash('sha256').update(second).digest('hex'),
      },
    ],
  };
  await writeFile(path.join(bundle, 'llama-server.exe'), first);
  await writeFile(path.join(bundle, 'ModelLoom-runtime-host.exe'), second);
  const signed = await repository(repo, description);
  const capability = await createFixtureVerifier(signed.root).verify(repo, path.join(dir, 'state'));
  return { dir, bundle, root, capability };
}
it('copies checked dependencies into a new version and retains file locks during revalidation', async () => {
  const { capability, bundle, root } = await setup();
  const installed = await installExpanded(capability, bundle, root);
  expect(await readFile(path.join(installed.directory, 'llama-server.exe'), 'utf8')).toBe('exe');
  expect((await readdir(installed.directory)).sort()).toEqual([
    'ModelLoom-runtime-host.exe',
    'llama-server.exe',
  ]);
  const locks = await revalidateInstalled(installed);
  try {
    await expect(
      writeFile(path.join(installed.directory, 'llama-server.exe'), 'bad'),
    ).rejects.toThrow();
    await expect(rename(installed.directory, `${installed.directory}-replaced`)).rejects.toThrow();
  } finally {
    locks.release();
  }
});
it('keeps the previous directory intact when a tampered candidate is refused', async () => {
  const { capability, bundle, root } = await setup();
  const installed = await installExpanded(capability, bundle, root);
  await writeFile(path.join(bundle, 'llama-server.exe'), 'bad');
  await expect(installExpanded(capability, bundle, root)).rejects.toThrow('INSTALL_FAILED');
  expect(await readFile(path.join(installed.directory, 'llama-server.exe'), 'utf8')).toBe('exe');
});
it('never promotes an installed fixture package or a serialized receipt to live authority', async () => {
  const { capability, bundle, root } = await setup();
  const installed = await installExpanded(capability, bundle, root);
  expect(() => requireInstalledLive(installed)).toThrow('UNVERIFIED_PACKAGE');
  expect(() => requireInstalledLive({ ...installed })).toThrow('UNVERIFIED_PACKAGE');
});
it('rejects an unexpected executable dependency', async () => {
  const { capability, bundle, root } = await setup();
  await writeFile(path.join(bundle, 'extra.dll'), 'extra');
  await expect(installExpanded(capability, bundle, root)).rejects.toThrow('INSTALL_FAILED');
});
it('rejects reparse-point bundles', async () => {
  const { dir, capability, bundle, root } = await setup();
  const link = path.join(dir, 'link');
  await symlink(bundle, link, 'junction');
  await expect(installExpanded(capability, link, root)).rejects.toThrow('INSTALL_FAILED');
});
it('rejects post-install tampering and forged receipts', async () => {
  const { capability, bundle, root } = await setup();
  const installed = await installExpanded(capability, bundle, root);
  await writeFile(path.join(installed.directory, 'llama-server.exe'), 'bad');
  await expect(revalidateInstalled(installed)).rejects.toThrow('INSTALL_FAILED');
  await expect(revalidateInstalled({ ...installed })).rejects.toThrow('INSTALL_FAILED');
});
it.each(['llama-server.exe', 'ModelLoom-runtime-host.exe'])(
  'refuses missing, changed and linked original %s',
  async (name) => {
    for (const mutation of ['missing', 'changed', 'symlink', 'hardlink']) {
      const { capability, bundle, root } = await setup();
      const installed = await installExpanded(capability, bundle, root);
      const target = path.join(installed.directory, name);
      if (mutation === 'changed') await writeFile(target, 'bad');
      else {
        await rm(target);
        const original = path.join(bundle, name);
        if (mutation === 'symlink') await symlink(original, target, 'file');
        if (mutation === 'hardlink') await link(original, target);
      }
      await expect(revalidateInstalled(installed)).rejects.toThrow('INSTALL_FAILED');
    }
  },
);
it.each(['ModelLoom Development.exe', '.modelloom-launch-helper/ModelLoom Development.exe'])(
  'rejects an undeclared launch copy at %s',
  async (name) => {
    const { capability, bundle, root } = await setup();
    const installed = await installExpanded(capability, bundle, root);
    const target = path.join(installed.directory, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, 'exe');
    await expect(revalidateInstalled(installed)).rejects.toThrow('INSTALL_FAILED');
  },
);
