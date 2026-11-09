import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import {
  installExpanded,
  requireInstalledLive,
  revalidateInstalled,
} from '../../../../../../packages/core/src/runtime-package/install';
import {
  describeRuntime,
  parseInventory,
} from '../../../../../../packages/core/src/runtime-package/inventory';
import {
  createFixtureVerifier,
  packageEvidence,
} from '../../../../../../packages/core/src/runtime-package/verifier';
import { inventory } from '../../../../../../packages/core/tests/inventory-fixture';
import { repository } from '../../../../../../packages/core/tests/package-repository';
import { RuntimeDownloadDialog } from './RuntimeDownloadDialog';
import { RuntimeSettings } from './SettingsPage';
import type { RuntimeManagement } from './SettingsPage';

const scrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
});
afterAll(() => {
  if (scrollIntoView)
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', scrollIntoView);
  else delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
});

vi.mock('../../../../../../packages/core/src/hosts/windows-ownership.js', () => ({
  ownershipBinding: () => ({
    privateDirectory: (directory: string) =>
      // The native ACL and file seals are covered by the core installer suite.
      mkdirSync(directory, { recursive: true }),
    sealFiles: () => ({}),
    releaseFiles: () => {},
  }),
}));

it('discovers and installs a signed CUDA fixture and selects it for the next load', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'modelloom-settings-feed-'));
  try {
    const fixture = async (version: string) => {
      const metadata = path.join(directory, version, 'metadata');
      const assets = path.join(directory, version, 'assets');
      const payload = Buffer.from(`Fixture data for ${version}`);
      const files = inventory.files.map(({ path }) => ({
        path,
        length: payload.length,
        sha256: createHash('sha256').update(payload).digest('hex'),
      }));
      const manifest = {
        ...inventory,
        packageId: 'fixture-cuda',
        backend: 'cuda',
        minimumDriver: '551.61',
        version,
        files,
      };
      await mkdir(assets, { recursive: true });
      await Promise.all(files.map((file) => writeFile(path.join(assets, file.path), payload)));
      const { root } = await repository(metadata, manifest);
      const verifier = createFixtureVerifier(root);
      return {
        assets,
        verify: () => verifier.verify(metadata, path.join(directory, version, 'state')),
      };
    };
    const baseline = await fixture('b11306-dev14');
    const release = await fixture('b11306-dev16');
    const store = path.join(directory, 'installed');
    const preference = path.join(directory, 'selected.json');
    const baselinePackage = await baseline.verify();
    const baselineInstall = await installExpanded(baselinePackage, baseline.assets, store);
    const original = describeRuntime(packageEvidence(baselinePackage).inventory);
    const download = vi.fn(copyFile);
    const checkForUpdates = vi.fn(async () => {
      const verified = packageEvidence(await release.verify()).inventory;
      return [
        {
          build: describeRuntime(verified),
          size: `${verified.files.reduce((sum, file) => sum + file.length, 0)} bytes`,
        },
      ];
    });
    const management: RuntimeManagement = {
      installed: [original],
      checkForUpdates,
      async install(build, onProgress) {
        const verified = await release.verify();
        const { inventory: manifest } = packageEvidence(verified);
        if (build.version !== manifest.version) throw new Error('Unknown fixture');
        const staging = await mkdtemp(path.join(directory, 'download-'));
        try {
          let received = 0;
          for (const file of manifest.files) {
            await download(path.join(release.assets, file.path), path.join(staging, file.path));
            received += file.length;
            onProgress(`Downloaded ${received} bytes`);
          }
          onProgress('Verifying and installing runtime…');
          const installed = await installExpanded(verified, staging, store);
          expect(() => requireInstalledLive(installed)).toThrow('UNVERIFIED_PACKAGE');
          return [describeRuntime(manifest), original];
        } finally {
          await rm(staging, { recursive: true, force: true });
        }
      },
      async select(build) {
        await writeFile(preference, build.version);
        return build;
      },
    };
    const user = userEvent.setup();
    const { unmount } = render(
      <RuntimeSettings
        activeRuntime={original}
        selectedRuntime={original}
        management={management}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Download runtimes' }));
    await screen.findByRole('button', { name: 'Download CUDA' });
    expect(download).not.toHaveBeenCalled();

    const downloadButton = screen.getByRole('button', { name: 'Download CUDA' });
    download.mockRejectedValueOnce(new Error('Fixture download interrupted'));
    await user.click(downloadButton);
    await screen.findByText('Could not install this runtime. Try again.');
    expect(screen.getByText('1 verified version installed.')).toBeVisible();

    await user.click(downloadButton);
    await screen.findByText('Runtime installed.');
    await expect(readFile(preference)).rejects.toMatchObject({ code: 'ENOENT' });
    await user.click(screen.getByRole('button', { name: 'Done' }));
    await user.click(screen.getByRole('button', { name: /^GGUF runtime:/ }));
    await user.click(screen.getByText(/llama\.cpp.*b11306 · dev16/));
    await screen.findByText('Selected for the next model load.');
    await user.click(screen.getByRole('button', { name: 'Manage installed runtimes' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Installed runtimes' }));
    expect(dialog.getByText('b11306 · dev16').parentElement?.parentElement).toHaveTextContent(
      'Selected',
    );
    expect(dialog.getByText('b11306 · dev14').parentElement?.parentElement).toHaveTextContent(
      'In use',
    );

    unmount();
    const selected = describeRuntime(packageEvidence(await release.verify()).inventory);
    expect(await readFile(preference, 'utf8')).toBe(selected.version);
    render(
      <RuntimeSettings
        activeRuntime={null}
        selectedRuntime={selected}
        management={{ ...management, installed: [selected, original] }}
      />,
    );
    expect(screen.getByRole('button', { name: /^GGUF runtime:/ })).toBeVisible();
    expect(screen.getByText(/llama\.cpp.*b11306 · dev16/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Manage installed runtimes' }));
    const older = screen.getByRole('button', { name: 'Show older versions' });
    expect(screen.queryByText('b11306 · dev14')).not.toBeInTheDocument();
    await user.click(older);
    expect(screen.getByText('b11306 · dev14')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Close dialog' }));
    const lock = await revalidateInstalled(baselineInstall);
    lock.release();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 15_000);

it('installs and selects the chosen GPU runtime during first-launch setup', async () => {
  const cuda = describeRuntime(
    parseInventory({ ...inventory, backend: 'cuda', minimumDriver: '551.78' }),
  );
  const vulkan = { ...cuda, backend: 'vulkan' as const, packageId: 'fixture-vulkan' };
  const install = vi.fn(() => Promise.resolve([vulkan]));
  const select = vi.fn(() => Promise.resolve(vulkan));
  const onClose = vi.fn();
  const onInstalled = vi.fn();
  render(
    <RuntimeDownloadDialog
      firstLaunch
      installed={[]}
      management={{
        installed: [],
        checkForUpdates: () =>
          Promise.resolve([cuda, vulkan].map((build) => ({ build, size: '1 MB' }))),
        install,
        select,
      }}
      onInstalled={onInstalled}
      onClose={onClose}
    />,
  );

  const user = userEvent.setup();
  const vulkanButton = await screen.findByRole('button', { name: 'Download Vulkan' });
  expect(screen.getByRole('button', { name: 'Download CUDA' })).toBeEnabled();
  expect(install).not.toHaveBeenCalled();
  await user.click(vulkanButton);
  expect(install).toHaveBeenCalledWith(vulkan, expect.any(Function));
  expect(onInstalled).toHaveBeenCalledWith([vulkan]);
  expect(select).toHaveBeenCalledWith(vulkan);
  expect(onClose).toHaveBeenCalledOnce();
});

it('shows the verified GPU runtime picker and independent selected and active status', async () => {
  const baseline = describeRuntime(
    parseInventory({ ...inventory, backend: 'cuda', minimumDriver: '551.78' }),
  );
  const next = {
    ...baseline,
    packageId: 'llama-cuda-development-b11307-validation',
    version: 'b11307-dev2',
  };
  const selected = next;
  const command = vi.fn(() =>
    Promise.resolve({
      enabled: true,
      model: null,
      phase: 'ready' as const,
      error: null,
      selectedRuntime: selected,
      activeRuntime: baseline,
      runtimeInventory: {
        status: 'ready' as const,
        selected,
        installed: true,
        choices: [
          { id: 'b11306' as const, build: baseline },
          { id: 'b11307' as const, build: next },
        ],
      },
    }),
  );
  window.modelLoomRuntime = { command };
  try {
    const user = userEvent.setup();
    render(<RuntimeSettings selectedRuntime={baseline} activeRuntime={baseline} />);
    await screen.findByText('2 verified versions installed.');
    expect(screen.getByRole('button', { name: /^GGUF runtime:/ })).toBeVisible();
    expect(screen.getByText(/llama\.cpp.*b11307/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Manage installed runtimes' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Installed runtimes' }));
    expect(dialog.getByText('Bonsai validation build')).toBeVisible();
    expect(dialog.getByText('In use')).toBeVisible();
    expect(dialog.getByText('Selected')).toBeVisible();
  } finally {
    delete window.modelLoomRuntime;
  }
});

it('selects Vulkan for the next load without changing the loaded CUDA runtime', async () => {
  // jsdom does not implement this browser method used by the SDK select.
  const scroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
  try {
    const cuda = describeRuntime(
      parseInventory({ ...inventory, backend: 'cuda', minimumDriver: '551.78' }),
    );
    const vulkan = {
      ...cuda,
      backend: 'vulkan' as const,
      packageId: 'llama-vulkan-development',
      version: 'b11306-dev1',
      artifact: 'b11306-vulkan-msvc14.44-dev1',
    };
    const select = vi.fn(() => Promise.resolve(vulkan));
    render(
      <RuntimeSettings
        activeRuntime={cuda}
        selectedRuntime={cuda}
        management={{
          installed: [cuda, vulkan],
          select,
          checkForUpdates: () => Promise.resolve([]),
          install: () => Promise.resolve([]),
        }}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^GGUF runtime:/ }));
    await user.click(await screen.findByRole('option', { name: /Vulkan/ }));
    await screen.findByText('Selected for the next model load.');
    expect(select).toHaveBeenCalledWith(vulkan);
    expect(screen.getByRole('button', { name: /^GGUF runtime:.*Vulkan/ })).toBeVisible();
    expect(screen.getByText(/llama\.cpp · CUDA/)).toBeVisible();
  } finally {
    if (scroll) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', scroll);
    else delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
  }
});

it('populates the picker without Manage and retains the request when active status changes', async () => {
  const cuda = describeRuntime(
    parseInventory({ ...inventory, backend: 'cuda', minimumDriver: '551.78' }),
  );
  let resolve!: (value: unknown) => void;
  const command = vi.fn(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  window.modelLoomRuntime = { command } as unknown as NonNullable<Window['modelLoomRuntime']>;
  try {
    const { rerender } = render(<RuntimeSettings selectedRuntime={cuda} activeRuntime={null} />);
    rerender(<RuntimeSettings selectedRuntime={cuda} activeRuntime={cuda} />);
    expect(command).toHaveBeenCalledTimes(1);
    resolve({
      runtimeInventory: {
        status: 'ready',
        selected: cuda,
        installed: true,
        choices: [{ id: 'b11306', build: cuda }],
      },
    });
    await screen.findByText('1 verified version installed.');
    expect(screen.getByRole('button', { name: /^GGUF runtime:/ })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  } finally {
    delete window.modelLoomRuntime;
  }
});
