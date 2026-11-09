import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { inventory } from '../../tests/inventory-fixture.js';
import { createRuntimeCatalogManagement } from './catalog-management.js';
import { installRuntimeCatalogTarget } from './catalog-install.js';

vi.mock('../hosts/windows-ownership.js', () => ({
  ownershipBinding: () => ({ privateDirectory: vi.fn() }),
}));
vi.mock('./verifier.js', () => ({
  createRuntimeVerifier: () => ({
    verify: (repository: string) =>
      Promise.resolve({
        ...inventory,
        backend: path.basename(repository).includes('vulkan') ? 'vulkan' : 'cuda',
      }),
  }),
  requireLivePackage: (pack: unknown) => ({ inventory: pack }),
}));
vi.mock('./install.js', () => ({
  findInstalledRuntime: (pack: unknown) => Promise.resolve(pack),
  requireInstalledLive: (pack: unknown) => pack,
}));
vi.mock('./catalog-install.js', () => ({
  installRuntimeCatalogTarget: vi.fn(
    async (options: Parameters<typeof installRuntimeCatalogTarget>[0]) => {
      await mkdir(options.repository);
      return { ...inventory, backend: options.backend };
    },
  ),
}));

it.each(['cuda', 'vulkan'] as const)(
  'keeps both packs installed and restores the selection after starting with %s',
  async (first) => {
    const store = await mkdtemp(path.join(os.tmpdir(), 'modelloom-catalog-management-'));
    try {
      const options = {
        root: Buffer.alloc(0),
        endpoints: {
          metadata: 'https://catalog.example.invalid/',
          assets: 'https://assets.example.invalid/',
        },
        store,
      };
      const other = first === 'cuda' ? 'vulkan' : 'cuda';
      const management = createRuntimeCatalogManagement(options);
      await expect(management.selected()).resolves.toBeUndefined();
      await expect(management.select(first)).rejects.toThrow('MISSING_RUNTIME');
      await management.install(first);
      await management.select(first);
      await management.install(other);
      await expect(management.selected()).resolves.toMatchObject({ backend: first });
      await management.select(other);

      const restarted = createRuntimeCatalogManagement(options);
      await expect(restarted.selected()).resolves.toMatchObject({ backend: other });
      expect((await restarted.inventory()).map(({ backend }) => backend)).toEqual([
        'cuda',
        'vulkan',
      ]);
      vi.mocked(installRuntimeCatalogTarget).mockClear();
      await restarted.install(first);
      expect(installRuntimeCatalogTarget).not.toHaveBeenCalled();
    } finally {
      await rm(store, { recursive: true, force: true });
    }
  },
);
