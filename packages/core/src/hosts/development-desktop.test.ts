import { beforeEach, expect, it, vi } from 'vitest';
import path from 'node:path';
import { developmentDesktopDependencies } from './development-desktop.js';
import type * as DevelopmentPolicy from '../runtime-package/development-policy.js';
import type { DesktopDeployment } from './desktop.js';
import { discoverResources } from './resource-probe.js';

const startup = vi.hoisted(() => ({
  admit: vi.fn(),
  close: vi.fn(),
  verify: vi.fn(),
  install: vi.fn(),
  adapter: vi.fn(),
  deployment: undefined as DesktopDeployment | undefined,
}));
vi.mock('./windows-ownership.js', () => ({
  ownershipBinding: () => ({
    createDeployment: () => ({}),
    privateDirectory: () => undefined,
    admitCore: startup.admit,
    closeDeployment: startup.close,
    coresExited: () => true,
  }),
  confirmExit: (done: () => boolean) => {
    return done() ? Promise.resolve() : Promise.reject(new Error('CLEANUP_FAILED'));
  },
}));
vi.mock('../runtime-package/verifier.js', () => ({
  createDevelopmentRuntimeVerifier: () => ({ verify: startup.verify }),
}));
vi.mock('../runtime-package/install.js', () => ({
  installExpanded: startup.install,
  requireInstalledLive: () => ({ backend: 'cuda', version: 'observed-version' }),
}));
vi.mock('./real-engine.js', () => ({ realEngineAdapter: startup.adapter }));
vi.mock('./desktop.js', () => ({
  createDesktopEngineHost: (_fork: unknown, deployment: DesktopDeployment) => {
    startup.deployment = deployment;
    return Promise.resolve({ close: () => deployment.close() });
  },
}));

vi.mock('../runtime-package/development-policy.js', async (original) => ({
  ...(await original<typeof DevelopmentPolicy>()),
  DEVELOPMENT_BUILD: true,
}));
vi.mock('./resource-probe.js', () => ({
  discoverResources: vi.fn(() =>
    Promise.resolve({
      ram: 10 * 2 ** 30,
      gpus: [
        {
          uuid: 'GPU-22c23971-dacf-2123-2169-ad70d8f6729a',
          driver: '617.14',
          total: 16 * 2 ** 30,
          free: 5 * 2 ** 30,
          mig: '[N/A]',
          driverModel: 'WDDM',
        },
      ],
    }),
  ),
}));
beforeEach(() => vi.clearAllMocks());

it('keeps writable verification and installations outside bundled bootstrap assets', async () => {
  const bootstrap = path.resolve('fixture-package/bootstrap');
  const state = path.resolve('fixture-runtime');
  const deps = developmentDesktopDependencies(
    () => {
      throw new Error('UNEXPECTED_FORK');
    },
    bootstrap,
    path.resolve('fixture-profile'),
    'window',
    state,
  );
  startup.verify.mockResolvedValueOnce('verified');
  startup.install.mockRejectedValueOnce(new Error('INSTALL_FAILED'));
  const host = await deps.createHistoryHost();
  await expect(host.prepare('approved.gguf')).rejects.toThrow('INSTALL_FAILED');
  expect(startup.verify).toHaveBeenCalledWith(
    path.join(bootstrap, 'repository'),
    path.join(state, 'desktop-verification'),
  );
  expect(startup.install).toHaveBeenCalledWith(
    'verified',
    path.join(bootstrap, 'candidate'),
    path.join(state, 'installed'),
  );
  await host.close();
});

it('preflights desktop Chat against four slots rather than the older one-slot report', async () => {
  const dependencies = developmentDesktopDependencies(() => {
    throw new Error('UNEXPECTED_FORK');
  }, 'unused');
  await expect(dependencies.preflight()).rejects.toThrow('INSUFFICIENT_RESOURCES');
});

it('starts an owned history core without package verification, installation or engine authority', async () => {
  const deps = developmentDesktopDependencies(
    () => {
      throw new Error('UNEXPECTED_FORK');
    },
    'unused',
    'trusted-profile',
    'captured-window',
  );
  const host = await deps.createHistoryHost();
  expect(startup.verify).not.toHaveBeenCalled();
  expect(deps.runtimeBackends()).toBeUndefined();
  expect(startup.install).not.toHaveBeenCalled();
  expect(startup.adapter).not.toHaveBeenCalled();
  const deployment = startup.deployment!;
  expect(deployment.chatSetup?.caller).toBe('captured-window');
  deployment.admitCore(100, 'trusted-image', 10);
  expect(startup.admit).toHaveBeenCalledWith(expect.any(Object), 100, 'trusted-image', 10);
  await expect(
    deployment.adapter.launch(
      {
        deploymentId: deps.deploymentId,
        packageId: deps.packageId,
        modelId: deps.expectedHash,
        sessionId: 's',
        operationId: 'o',
      },
      new AbortController().signal,
    ),
  ).rejects.toThrow('NOT_READY');
  await host.close();
  expect(startup.close).toHaveBeenCalledTimes(1);
});

it('does not confer engine launch authority when package preparation fails', async () => {
  const deps = developmentDesktopDependencies(() => {
    throw new Error('UNEXPECTED_FORK');
  }, 'unused');
  const host = await deps.createHistoryHost();
  startup.verify.mockRejectedValueOnce(new Error('PACKAGE_VERIFICATION_FAILED'));
  await expect(host.prepare('approved.gguf')).rejects.toThrow('PACKAGE_VERIFICATION_FAILED');
  expect(startup.install).not.toHaveBeenCalled();
  expect(startup.adapter).not.toHaveBeenCalled();
  await expect(
    startup.deployment!.adapter.launch(
      {
        deploymentId: deps.deploymentId,
        packageId: deps.packageId,
        modelId: deps.expectedHash,
        sessionId: 's',
        operationId: 'o',
      },
      new AbortController().signal,
    ),
  ).rejects.toThrow('NOT_READY');
  await host.close();
  await expect(host.prepare('approved.gguf')).rejects.toThrow('CORE_EXITED');
  expect(startup.verify).toHaveBeenCalledTimes(1);
});

it('reuses the verifier-issued installation across model preparations without repeating package copies', async () => {
  const deps = developmentDesktopDependencies(() => {
    throw Error('UNEXPECTED_FORK');
  }, 'unused');
  const host = await deps.createHistoryHost();
  const installed = { packageId: deps.packageId, directory: 'verified-installation' };
  startup.verify.mockResolvedValueOnce('verified-capability');
  startup.install.mockResolvedValueOnce(installed);
  const first = { close: vi.fn(() => Promise.resolve()) };
  const second = { close: vi.fn(() => Promise.resolve()) };
  startup.adapter.mockReturnValueOnce(first).mockReturnValueOnce(second);
  await host.prepare('first.gguf');
  await host.prepare('second.gguf');
  expect(startup.verify).toHaveBeenCalledTimes(1);
  expect(startup.install).toHaveBeenCalledTimes(1);
  expect(first.close).toHaveBeenCalledTimes(1);
  expect(startup.adapter.mock.calls.at(-1)?.[0]).toBe(installed);
  await host.close();
  expect(second.close).toHaveBeenCalledTimes(1);
});

it('waits for pending package preparation on close without granting late engine authority', async () => {
  const deps = developmentDesktopDependencies(() => {
    throw new Error('UNEXPECTED_FORK');
  }, 'unused');
  const host = await deps.createHistoryHost();
  let release!: (value: unknown) => void;
  startup.verify.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const preparing = host.prepare('approved.gguf');
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  let closed = false;
  const closing = host.close().then(() => {
    closed = true;
  });
  await Promise.resolve();
  expect(closed).toBe(false);
  release({});
  await expect(preparing).rejects.toThrow('CORE_EXITED');
  await closing;
  expect(startup.adapter).not.toHaveBeenCalled();
});

it('binds the admitted engine after verification and closes it with the history core', async () => {
  const deps = developmentDesktopDependencies(() => {
    throw new Error('UNEXPECTED_FORK');
  }, 'unused');
  const host = await deps.createHistoryHost();
  const selection = {
    deploymentId: deps.deploymentId,
    packageId: deps.packageId,
    modelId: deps.expectedHash,
    sessionId: 's',
    operationId: 'o',
  };
  const engine = {
    selection,
    exited: Promise.resolve({ code: 0, signal: null }),
    waitReady: () => Promise.resolve(),
    requestStop: () => Promise.resolve(),
    forceStop: () => Promise.resolve(),
  };
  const adapter = {
    launch: vi.fn(() => Promise.resolve(engine)),
    close: vi.fn(() => Promise.resolve()),
    children: () => [123],
  };
  const installed = { packageId: deps.packageId, directory: 'verified-installation' };
  startup.verify.mockResolvedValueOnce('verified-capability');
  startup.install.mockResolvedValueOnce(installed);
  startup.adapter.mockReturnValueOnce(adapter);
  await host.prepare('approved.gguf');
  expect(deps.runtimeBackends()).toEqual(['cuda (observed-version)']);
  expect(startup.install).toHaveBeenCalledWith(
    'verified-capability',
    expect.any(String),
    expect.any(String),
  );
  expect(startup.adapter).toHaveBeenCalledWith(
    installed,
    'approved.gguf',
    expect.objectContaining({ slots: 4 }),
    18478,
    expect.any(Function),
    undefined,
  );
  const takeConfirmation = startup.adapter.mock.calls.at(-1)![4] as () => boolean;
  expect(takeConfirmation()).toBe(false);
  const sharedSnapshot = {
    ram: 32 * 2 ** 30,
    gpuQuery: 'OK',
    gpus: [
      {
        uuid: 'GPU-22c23971-dacf-2123-2169-ad70d8f6729a',
        bus: '00000000:04:00.0',
        driver: '617.14',
        total: 16 * 2 ** 30,
        free: 5 * 2 ** 30,
        mig: '[N/A]' as const,
        driverModel: 'WDDM' as const,
      },
    ],
  };
  vi.mocked(discoverResources).mockResolvedValueOnce(sharedSnapshot);
  await deps.preflight(true);
  expect(takeConfirmation()).toBe(true);
  expect(takeConfirmation()).toBe(false);
  let release!: (snapshot: typeof sharedSnapshot) => void;
  vi.mocked(discoverResources).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const stalePreflight = deps.preflight(true);
  void stalePreflight.catch(() => undefined);
  vi.mocked(discoverResources).mockResolvedValueOnce(sharedSnapshot);
  await expect(deps.preflight()).rejects.toThrow('SHARED_GPU_MEMORY_CONFIRMATION');
  release(sharedSnapshot);
  await expect(stalePreflight).rejects.toThrow('START_FAILED');
  expect(takeConfirmation()).toBe(false);
  expect(await startup.deployment!.adapter.launch(selection, new AbortController().signal)).toBe(
    engine,
  );
  expect(startup.deployment!.children()).toEqual([123]);
  await host.close();
  expect(adapter.close).toHaveBeenCalledTimes(1);
  await expect(
    startup.deployment!.adapter.launch(selection, new AbortController().signal),
  ).rejects.toThrow('NOT_READY');
});
