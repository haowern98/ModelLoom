import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { inventory } from '../../tests/inventory-fixture.js';
import { repository } from '../../tests/package-repository.js';
import { installRuntimeCatalogTarget } from './catalog-install.js';
import { createFixtureVerifier } from './verifier.js';

vi.mock(import('./verifier.js'), async (importOriginal) => {
  const verifier = await importOriginal();
  return { ...verifier, requireLivePackage: verifier.packageEvidence };
});

vi.mock('../hosts/windows-ownership.js', () => ({
  ownershipBinding: () => ({
    privateDirectory: (directory: string) => mkdirSync(directory, { recursive: true }),
    sealFiles: () => ({}),
    releaseFiles: () => undefined,
    systemDirectory: () => path.join(process.env.SystemRoot!, 'System32'),
  }),
}));

it.skipIf(process.platform !== 'win32')(
  'installs a signed archive with versioned metadata',
  async () => {
    const work = await mkdtemp(path.join(os.tmpdir(), 'modelloom-catalog-install-'));
    try {
      const payload = path.join(work, 'payload');
      const candidate = path.join(payload, 'candidate');
      const repo = path.join(payload, 'repository');
      const store = path.join(work, 'store');
      await mkdir(candidate, { recursive: true });
      await mkdir(store);
      const files = await Promise.all(
        ['llama-server.exe', 'ModelLoom-runtime-host.exe'].map(async (name) => {
          const bytes = Buffer.from(name);
          await writeFile(path.join(candidate, name), bytes);
          return {
            path: name,
            length: bytes.length,
            sha256: createHash('sha256').update(bytes).digest('hex'),
          };
        }),
      );
      const pack = await repository(
        repo,
        { ...inventory, backend: 'cuda', minimumDriver: '1.0', files },
        undefined,
        {},
        true,
      );
      const archive = path.join(work, 'runtime.zip');
      execFileSync(
        path.join(process.env.SystemRoot!, 'System32', 'tar.exe'),
        ['-a', '-cf', archive, '-C', payload, 'candidate', 'repository'],
        { windowsHide: true },
      );
      const zip = await readFile(archive);
      const catalog = path.join(work, 'catalog');
      const { root } = await repository(
        catalog,
        inventory,
        undefined,
        { 'runtime-b11306-cuda.zip': zip },
        true,
      );
      vi.stubGlobal('fetch', async (input: string) => {
        const url = new URL(input);
        const name = url.pathname.slice(1);
        if (name === '2.root.json') return new Response(null, { status: 404 });
        const bytes =
          url.hostname === 'assets.example.invalid'
            ? zip
            : await readFile(path.join(catalog, name));
        return new Response(new Uint8Array(bytes));
      });
      const retained = path.join(store, 'catalog-cuda-repository');
      const verify = (source: string) =>
        createFixtureVerifier(pack.root).verify(source, path.join(work, 'state'));
      const installed = await installRuntimeCatalogTarget({
        root,
        backend: 'cuda',
        endpoints: {
          metadata: 'https://catalog.example.invalid/',
          assets: 'https://assets.example.invalid/',
        },
        store,
        repository: retained,
        verify,
      });
      expect(await readFile(path.join(installed.directory, 'llama-server.exe'), 'utf8')).toBe(
        'llama-server.exe',
      );
      await expect(verify(retained)).resolves.toBeDefined();
    } finally {
      vi.unstubAllGlobals();
      await rm(work, { recursive: true, force: true });
    }
  },
  15_000,
);
