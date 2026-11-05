import { afterEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type * as FsPromises from 'node:fs/promises';
import {
  link,
  copyFile,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  statfs,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { repository } from '../../tests/package-repository.js';
import { inventory } from '../../tests/inventory-fixture.js';
import { createFixtureVerifier } from './verifier.js';
import {
  installExpanded,
  installInRuntimeStore,
  hasRuntimeInstallation,
  findInstalledRuntime,
  revalidateInstalled,
  requireInstalledLive,
} from './install.js';
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return {
    ...actual,
    statfs: vi.fn(actual.statfs),
    copyFile: vi.fn(actual.copyFile),
    rm: vi.fn(actual.rm),
  };
});
const actualFs = await vi.importActual<typeof FsPromises>('node:fs/promises');
const dirs: string[] = [];
afterEach(async () => {
  vi.mocked(statfs).mockReset().mockImplementation(actualFs.statfs);
  vi.mocked(copyFile).mockReset().mockImplementation(actualFs.copyFile);
  vi.mocked(rm).mockReset().mockImplementation(actualFs.rm);
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
  return { dir, bundle, root, capability, repo, signed };
}
it('lists an installation without granting reuse authority or hashing its payload', async () => {
  const { capability, bundle, root } = await setup();
  const installed = await installExpanded(capability, bundle, root);
  await writeFile(path.join(installed.directory, 'llama-server.exe'), 'bad');
  await expect(hasRuntimeInstallation(capability, root)).resolves.toBe(true);
  await expect(findInstalledRuntime(capability, root)).resolves.toBeUndefined();
  await expect(revalidateInstalled(installed)).rejects.toThrow('INSTALL_FAILED');
  await rm(installed.directory, { recursive: true });
  await expect(hasRuntimeInstallation(capability, root)).resolves.toBe(false);
});

it('ignores malformed installation names and directory links in the display index', async () => {
  const { capability, root, bundle } = await setup();
  const { packageEvidence } = await import('./verifier.js');
  const manifest = packageEvidence(capability).inventory;
  await mkdir(root);
  await mkdir(path.join(root, `${manifest.packageId}-${manifest.version}-not-an-id`));
  await symlink(
    bundle,
    path.join(
      root,
      `${manifest.packageId}-${manifest.version}-11111111-1111-4111-8111-111111111111`,
    ),
    'junction',
  );
  await expect(hasRuntimeInstallation(capability, root)).resolves.toBe(false);
});
it('reuses a verified installation with a fresh receipt and freshly verified capability', async () => {
  const { capability, bundle, root, dir, repo, signed } = await setup();
  const first = await installExpanded(capability, bundle, root);
  const nextCapability = await createFixtureVerifier(signed.root).verify(
    repo,
    path.join(dir, 'next-state'),
  );
  const second = await installExpanded(nextCapability, bundle, root);
  expect(second).not.toBe(first);
  expect(second.directory).toBe(first.directory);
  expect(await readdir(root)).toHaveLength(1);
  const lock = await revalidateInstalled(second);
  lock.release();
  await expect(revalidateInstalled({ ...second })).rejects.toThrow('INSTALL_FAILED');
  expect(() => requireInstalledLive(second)).toThrow('UNVERIFIED_PACKAGE');
});
it('serializes concurrent installation requests into one verified directory', async () => {
  const { capability, bundle, root } = await setup();
  const installed = await Promise.all(
    Array.from({ length: 3 }, () => installExpanded(capability, bundle, root)),
  );
  expect(new Set(installed.map((item) => item.directory)).size).toBe(1);
  expect(await readdir(root)).toHaveLength(1);
});
it('reissues authority for a verified cached installation in a fresh module lifetime', async () => {
  const { capability, bundle, root, dir, repo, signed } = await setup();
  const previous = await installExpanded(capability, bundle, root);
  vi.resetModules();
  const freshVerifier = await import('./verifier.js');
  const freshInstaller = await import('./install.js');
  const freshCapability = await freshVerifier
    .createFixtureVerifier(signed.root)
    .verify(repo, path.join(dir, 'fresh-state'));
  const current = await freshInstaller.installExpanded(freshCapability, bundle, root);
  expect(current.directory).toBe(previous.directory);
  await expect(freshInstaller.revalidateInstalled(previous)).rejects.toThrow('INSTALL_FAILED');
  const lock = await freshInstaller.revalidateInstalled(current);
  lock.release();
  expect(() => freshInstaller.requireInstalledLive(current)).toThrow('UNVERIFIED_PACKAGE');
});
it('preserves a tampered matching installation and creates a verified replacement', async () => {
  const { capability, bundle, root } = await setup();
  const first = await installExpanded(capability, bundle, root);
  await writeFile(path.join(first.directory, 'llama-server.exe'), 'bad');
  const second = await installExpanded(capability, bundle, root);
  expect(second.directory).not.toBe(first.directory);
  expect(await readFile(path.join(first.directory, 'llama-server.exe'), 'utf8')).toBe('bad');
  expect(await readFile(path.join(second.directory, 'llama-server.exe'), 'utf8')).toBe('exe');
  expect(await readdir(root)).toHaveLength(2);
});
it('rejects insufficient free space before creating an installation candidate', async () => {
  const { capability, bundle, root } = await setup();
  const disk = await actualFs.statfs(bundle);
  vi.mocked(statfs).mockResolvedValue({ ...disk, bavail: 0 });
  vi.mocked(copyFile).mockClear();
  await expect(installExpanded(capability, bundle, root)).rejects.toThrow(
    'INSUFFICIENT_DISK_SPACE',
  );
  expect(await readdir(root)).toEqual([]);
  expect(copyFile).not.toHaveBeenCalled();
});
it('reuses a verified installation even when no free disk space remains', async () => {
  const { capability, bundle, root } = await setup();
  const first = await installExpanded(capability, bundle, root);
  const disk = await actualFs.statfs(bundle);
  vi.mocked(statfs).mockResolvedValue({ ...disk, bavail: 0 });
  vi.mocked(copyFile).mockClear();
  const second = await installExpanded(capability, bundle, root);
  expect(second.directory).toBe(first.directory);
  expect(await readdir(root)).toHaveLength(1);
  expect(copyFile).not.toHaveBeenCalled();
});

it('uses a verified legacy copy on a full profile drive and migrates when space is available', async () => {
  const { capability, bundle, root, dir } = await setup();
  const profile = path.join(dir, 'profile-runtimes');
  const legacy = await installExpanded(capability, bundle, root);
  const disk = await actualFs.statfs(bundle);
  vi.mocked(statfs).mockResolvedValueOnce({ ...disk, bavail: 0 });
  const fallback = await installInRuntimeStore(capability, bundle, profile, root);
  expect(fallback.directory).toBe(legacy.directory);
  expect(await readdir(profile)).toEqual([]);

  const migrated = await installInRuntimeStore(capability, bundle, profile, root);
  expect(path.dirname(migrated.directory)).toBe(profile);
  expect(await readdir(root)).toEqual([path.basename(legacy.directory)]);
});
it('removes only its partial candidate when copying runs out of disk space', async () => {
  const { capability, bundle, root } = await setup();
  const previous = await installExpanded(capability, bundle, root);
  await writeFile(path.join(previous.directory, 'llama-server.exe'), 'bad');
  vi.mocked(copyFile).mockClear();
  vi.mocked(copyFile)
    .mockImplementationOnce(actualFs.copyFile)
    .mockRejectedValueOnce(Object.assign(new Error('full'), { code: 'ENOSPC' }));
  await expect(installExpanded(capability, bundle, root)).rejects.toThrow(
    'INSUFFICIENT_DISK_SPACE',
  );
  expect(copyFile).toHaveBeenCalledTimes(2);
  expect(await readdir(root)).toEqual([path.basename(previous.directory)]);
  expect(await readFile(path.join(previous.directory, 'llama-server.exe'), 'utf8')).toBe('bad');
});
it('retains the disk-space failure and cleanup error when a partial candidate cannot be removed', async () => {
  const { capability, bundle, root } = await setup();
  const diskError = Object.assign(new Error('full'), { code: 'ENOSPC' });
  const cleanupError = Object.assign(new Error('busy'), { code: 'EBUSY' });
  vi.mocked(copyFile).mockRejectedValueOnce(diskError);
  vi.mocked(rm).mockRejectedValueOnce(cleanupError);
  const failure: unknown = await installExpanded(capability, bundle, root).catch(
    (error: unknown) => error,
  );
  expect(failure).toBeInstanceOf(Error);
  expect(failure).toMatchObject({ message: 'INSUFFICIENT_DISK_SPACE' });
  expect((failure as Error).cause).toBeInstanceOf(AggregateError);
  expect(((failure as Error).cause as AggregateError).errors).toEqual([diskError, cleanupError]);
  expect(await readdir(root)).toHaveLength(1);
});
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
