import { lstat, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ownershipBinding } from '../hosts/windows-ownership.js';
import { installRuntimeCatalogTarget } from './catalog-install.js';
import { findInstalledRuntime, requireInstalledLive } from './install.js';
import { describeRuntime } from './inventory.js';
import type { RuntimePackageDescription } from './inventory.js';
import { createRuntimeVerifier, requireLivePackage } from './verifier.js';

const backends = ['cuda', 'vulkan'] as const;
type Backend = (typeof backends)[number];

function validBackend(value: unknown): value is Backend {
  return value === 'cuda' || value === 'vulkan';
}

/** Manages first-release packs using the production package verifier and a host-owned catalog. */
export function createRuntimeCatalogManagement(options: {
  root: Buffer;
  endpoints: { metadata: string; assets: string };
  store: string;
}) {
  const store = path.resolve(options.store);
  ownershipBinding().privateDirectory(store);
  const preference = path.join(store, 'catalog-selection.json');
  const repository = (backend: Backend) => path.join(store, `catalog-${backend}-repository`);
  const verify = (backend: Backend, source: string) =>
    createRuntimeVerifier().verify(source, path.join(store, `catalog-${backend}-verification`));

  // Serialize mutations and verification against shared metadata state in this host.
  let pending = Promise.resolve();
  function serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = pending.then(operation);
    pending = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async function installed(backend: Backend) {
    try {
      const state = await lstat(repository(backend));
      if (!state.isDirectory() || state.isSymbolicLink()) throw new Error('INVALID_STATE');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
    const capability = await verify(backend, repository(backend));
    if (requireLivePackage(capability).inventory.backend !== backend)
      throw new Error('UNSUPPORTED_RUNTIME');
    return findInstalledRuntime(capability, store);
  }

  async function selected() {
    let backend: string;
    try {
      const stat = await lstat(preference);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 6)
        throw new Error('INVALID_STATE');
      backend = await readFile(preference, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
    if (!validBackend(backend)) throw new Error('INVALID_STATE');
    return installed(backend);
  }

  return {
    installed: (backend: Backend) => serialize(() => installed(backend)),
    inventory: () =>
      serialize(async () => {
        const result = [];
        for (const backend of backends) {
          const pack = await installed(backend);
          if (pack) result.push(describeRuntime(requireInstalledLive(pack)));
        }
        return result;
      }),
    install: (backend: Backend) =>
      serialize(async () => {
        if (!validBackend(backend)) throw new Error('UNSUPPORTED_RUNTIME');
        const pack =
          (await installed(backend)) ??
          (await installRuntimeCatalogTarget({
            ...options,
            backend,
            store,
            repository: repository(backend),
            verify: (source) => verify(backend, source),
          }));
        return describeRuntime(requireInstalledLive(pack));
      }),
    select: (backend: Backend) =>
      serialize(async () => {
        if (!validBackend(backend)) throw new Error('UNSUPPORTED_RUNTIME');
        const pack = await installed(backend);
        if (!pack) throw new Error('MISSING_RUNTIME');
        const description = describeRuntime(requireInstalledLive(pack));
        const temporary = `${preference}.${randomUUID()}.tmp`;
        try {
          await writeFile(temporary, backend, { flag: 'wx' });
          await rename(temporary, preference);
        } finally {
          await unlink(temporary).catch(() => undefined);
        }
        return description;
      }),
    selected: () => serialize(selected),
  };
}

/** Bind the trusted release offers to the desktop command and load-selection paths. */
export function createDesktopRuntimeCatalog(
  management: ReturnType<typeof createRuntimeCatalogManagement>,
  offers: readonly { build: RuntimePackageDescription; size: string }[],
) {
  return {
    selected: management.selected,
    installed: management.installed,
    async command(
      this: void,
      input: { action: 'read' } | { action: 'install' | 'select'; backend: Backend },
    ) {
      if (input.action !== 'read') {
        if (!offers.some(({ build }) => build.backend === input.backend))
          throw new Error('UNSUPPORTED_RUNTIME');
        await management[input.action](input.backend);
      }
      const [installed, selected] = await Promise.all([
        management.inventory(),
        management.selected(),
      ]);
      return {
        installed,
        selected: selected ? describeRuntime(requireInstalledLive(selected)) : null,
        offers,
      };
    },
  };
}
