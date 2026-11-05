import { beforeEach, expect, it, vi } from 'vitest';
import path from 'node:path';
import { mkdir, mkdtemp, readFile, rm, utimes } from 'node:fs/promises';
import os from 'node:os';
import { developmentDesktopDependencies } from './development-desktop.js';
import type * as DevelopmentPolicy from '../runtime-package/development-policy.js';
import type { DesktopDeployment } from './desktop.js';
import { discoverResources } from './resource-probe.js';
import type { ClusterDraft } from '../cluster/contracts.js';
import { createDesktopPeerHost } from '../peers/desktop.js';
import { describeRuntime, parseInventory } from '../runtime-package/inventory.js';
import type { Inventory } from '../runtime-package/inventory.js';
import type { PeerCommand, PeerReply } from '../peers/wire.js';

const startup = vi.hoisted(() => ({
  admit: vi.fn(),
  close: vi.fn(),
  verify: vi.fn(),
  evidence: vi.fn<(capability: unknown) => { inventory: Inventory } | undefined>(),
  install: vi.fn(),
  findInstalled: vi.fn(),
  hasInstalled: vi.fn(),
  adapter: vi.fn(),
  setRuntimeBusy: vi.fn(() => Promise.resolve()),
  closePeers: vi.fn(() => Promise.resolve()),
  privateDirectory: vi.fn(() => undefined),
  candidates: vi.fn((...args: unknown[]) => {
    void args;
    return Promise.resolve({ code: 'NO_FIT' });
  }),
  deployment: undefined as DesktopDeployment | undefined,
}));
vi.mock('../cluster/auto-place.js', () => ({ autoPlace: startup.candidates }));
vi.mock('./placement-estimator.js', () => ({
  withPlacementModel: (_file: string, callback: (info: unknown) => unknown) =>
    callback({ sha256: 'a'.repeat(64), blockCount: 8 }),
  runPlacementEstimator: vi.fn(),
}));
vi.mock('../peers/desktop.js', () => ({
  createDesktopPeerHost: vi.fn(() =>
    Promise.resolve({
      subscribe: () => () => undefined,
      setRuntimeBusy: startup.setRuntimeBusy,
      close: startup.closePeers,
      command: () =>
        Promise.resolve({
          ok: true,
          view: {
            gpus: [],
            outgoing: [
              {
                phase: 'approved',
                localVerified: true,
                remoteVerified: true,
                peerFingerprint: 'b'.repeat(64),
                gpus: [{ id: 'GPU-11111111-1111-1111-1111-111111111111' }],
              },
            ],
          },
        }),
      resources: () =>
        Promise.resolve({
          runtimeId: 'verified-runtime',
          ram: 32 * 2 ** 30,
          gpus: [
            {
              uuid: 'GPU-11111111-1111-1111-1111-111111111111',
              total: 24 * 2 ** 30,
              free: 23 * 2 ** 30,
              mig: '[N/A]',
            },
          ],
        }),
    }),
  ),
}));
vi.mock('./windows-ownership.js', () => ({
  ownershipBinding: () => ({
    createDeployment: () => ({}),
    privateDirectory: startup.privateDirectory,
    admitCore: startup.admit,
    closeDeployment: startup.close,
    coresExited: () => true,
  }),
  confirmExit: (done: () => boolean) => {
    return done() ? Promise.resolve() : Promise.reject(new Error('CLEANUP_FAILED'));
  },
}));
const runtimeDescription = {
  packageId: 'llama-cuda-development',
  version: 'b11306-dev14',
  artifact: 'b11306-cuda12.4-msvc14.44-dev1',
  platform: 'win32',
  arch: 'x64',
  backend: 'cuda',
  upstreamCommit: '4f31296a907d73f3409f720429bcf31111615d77',
} as const;

vi.mock('../runtime-package/verifier.js', () => ({
  createDevelopmentRuntimeVerifier: () => ({ verify: startup.verify }),
  requireLivePackage: (capability: unknown) =>
    startup.evidence(capability) ?? { inventory: runtimeDescription },
}));
vi.mock('../runtime-package/install.js', () => ({
  installInRuntimeStore: startup.install,
  findInstalledRuntime: startup.findInstalled,
  hasRuntimeInstallation: startup.hasInstalled,
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

it('initializes peer directory permissions once while concurrent reads reuse the host', async () => {
  const fork = vi.fn();
  const runtimeStore = path.resolve('profile/runtimes');
  const deps = developmentDesktopDependencies(
    fork,
    'bootstrap',
    'profile',
    'window',
    'state',
    undefined,
    undefined,
    runtimeStore,
  );
  await Promise.all(Array.from({ length: 8 }, () => deps.peers({ action: 'read' })));
  await deps.peers({ action: 'read' });
  expect(createDesktopPeerHost).toHaveBeenCalledExactlyOnceWith(fork, 'profile', 'window', {
    bootstrap: path.join('bootstrap', 'peers'),
    state: path.join('state', 'peers'),
    runtimeStore,
  });
  expect(startup.privateDirectory).toHaveBeenCalledTimes(1);
  expect(startup.privateDirectory).toHaveBeenCalledWith(path.resolve('state'));
  expect(startup.privateDirectory.mock.invocationCallOrder[0]).toBeLessThan(
    vi.mocked(createDesktopPeerHost).mock.invocationCallOrder[0]!,
  );
  await deps.closePeers();
});

it('fails closed on peer directory permission failure and checks again on retry', async () => {
  const deps = developmentDesktopDependencies(vi.fn(), 'bootstrap', 'profile', 'window', 'state');
  startup.privateDirectory.mockImplementationOnce(() => {
    throw Error('OWNERSHIP_FAILED');
  });
  await expect(deps.peers({ action: 'read' })).rejects.toThrow('OWNERSHIP_FAILED');
  expect(createDesktopPeerHost).not.toHaveBeenCalled();
  await deps.peers({ action: 'read' });
  expect(startup.privateDirectory).toHaveBeenCalledTimes(2);
  expect(createDesktopPeerHost).toHaveBeenCalledTimes(1);
  await deps.closePeers();
});

it('rechecks directory permissions when peer host initialization must be retried', async () => {
  const deps = developmentDesktopDependencies(vi.fn(), 'bootstrap', 'profile', 'window', 'state');
  vi.mocked(createDesktopPeerHost).mockRejectedValueOnce(Error('CORE_START_FAILED'));
  await expect(deps.peers({ action: 'read' })).rejects.toThrow('CORE_START_FAILED');
  await deps.peers({ action: 'read' });
  await deps.peers({ action: 'read' });
  expect(startup.privateDirectory).toHaveBeenCalledTimes(2);
  expect(createDesktopPeerHost).toHaveBeenCalledTimes(2);
  await deps.closePeers();
});

it.each([
  ['local only', ['GPU-22c23971-dacf-2123-2169-ad70d8f6729a']],
  ['remote only', [`peer:${'b'.repeat(64)}:GPU-11111111-1111-1111-1111-111111111111`]],
  ['empty canvas', []],
] as const)('limits planner candidates to the explicit %s canvas', async (_name, devices) => {
  const deps = developmentDesktopDependencies(
    () => {
      throw Error('UNEXPECTED_FORK');
    },
    'unused',
    'trusted-profile',
    'captured-window',
  );
  startup.verify.mockResolvedValueOnce('verified');
  startup.install.mockResolvedValueOnce({});
  const draft = { modelId: 'a'.repeat(64) } as ClusterDraft;
  await expect(
    deps.planCluster('model.gguf', draft, 8, new AbortController().signal, devices),
  ).rejects.toThrow('INSUFFICIENT_RESOURCES');
  expect(startup.candidates).toHaveBeenCalledTimes(1);
  expect(startup.candidates.mock.calls[0]?.[1]).toEqual(devices);
});

it('keeps writable verification and installations outside bundled bootstrap assets', async () => {
  const bootstrap = path.resolve('fixture-package/bootstrap');
  const state = path.resolve('fixture-runtime');
  const runtimeStore = path.resolve('fixture-profile/runtimes');
  const deps = developmentDesktopDependencies(
    () => {
      throw new Error('UNEXPECTED_FORK');
    },
    bootstrap,
    path.resolve('fixture-profile'),
    'window',
    state,
    undefined,
    undefined,
    runtimeStore,
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
    runtimeStore,
    path.join(state, 'installed'),
  );
  await host.close();
});

it('prepares Vulkan with its own verification history after using CUDA', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'modelloom-runtime-switch-'));
  try {
    const cuda = path.join(root, 'b11306');
    const vulkan = path.join(root, 'b11306-vulkan');
    const fixture = JSON.parse(
      await readFile(new URL('../../tests/vulkan-inventories.json', import.meta.url), 'utf8'),
    ) as { vulkan: unknown };
    const vulkanInventory = parseInventory(fixture.vulkan);
    const vulkanState = path.join(cuda, 'runtime-selection', 'b11306-vulkan');
    const deps = developmentDesktopDependencies(
      vi.fn(),
      cuda,
      root,
      'window',
      cuda,
      undefined,
      undefined,
      path.join(root, 'runtimes'),
    );
    // CUDA has already established a higher metadata version in its launch cache.
    const verify = (repository: string, state: string) => {
      if (repository === path.join(vulkan, 'repository') && state !== vulkanState)
        return Promise.reject(Error('PACKAGE_VERIFICATION_FAILED'));
      return Promise.resolve(repository);
    };
    const prepare = async () => {
      const host = await deps.createHistoryHost();
      try {
        startup.install.mockRejectedValueOnce(Error('INSTALL_REACHED'));
        await expect(host.prepare('approved.gguf')).rejects.toThrow('INSTALL_REACHED');
      } finally {
        await host.close();
      }
    };
    await startup.verify.withImplementation(verify, async () => {
      await startup.evidence.withImplementation(
        (repository) =>
          repository === path.join(vulkan, 'repository')
            ? { inventory: vulkanInventory }
            : undefined,
        async () => {
          await prepare();
          await deps.selectRuntime('b11306-vulkan');
          await expect(deps.activateRuntime()).resolves.toEqual(describeRuntime(vulkanInventory));
          await prepare();
          await deps.peers({ action: 'read' });
          expect(startup.privateDirectory).toHaveBeenCalledWith(path.join(vulkan, 'peers'));
          expect(createDesktopPeerHost).toHaveBeenLastCalledWith(
            expect.any(Function),
            root,
            'window',
            expect.objectContaining({
              bootstrap: vulkan,
              state: path.join(cuda, 'peers'),
              verificationState: path.join(vulkan, 'peers', 'peer-verification'),
            }),
          );
          await deps.selectRuntime('b11306');
          await deps.activateRuntime();
          await prepare();
          expect(startup.verify).toHaveBeenLastCalledWith(
            path.join(cuda, 'repository'),
            path.join(cuda, 'desktop-verification'),
          );
        },
      );
    });
    await deps.closePeers();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it.each(['on', 'off', 'off-during-switch', 'failed-share'] as const)(
  'preserves sharing intent when %s during a runtime owner replacement',
  async (mode) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'modelloom-sharing-switch-'));
    const gpuId = 'GPU-11111111-1111-1111-1111-111111111111';
    const commands: { owner: number; command: PeerCommand }[] = [];
    const owners: { sharing: boolean; gpuIds: readonly string[] }[] = [];
    let releaseClose!: () => void;
    let notifyClosing!: () => void;
    const closeGate = new Promise<void>((resolve) => {
      releaseClose = resolve;
    });
    const closing = new Promise<void>((resolve) => {
      notifyClosing = resolve;
    });
    const factory = vi.mocked(createDesktopPeerHost).getMockImplementation()!;
    vi.mocked(createDesktopPeerHost).mockImplementation(async (...args) => {
      const host = await factory(...args);
      const owner = owners.length;
      const state = { sharing: false, gpuIds: [] as readonly string[] };
      owners.push(state);
      return {
        ...host,
        close: async () => {
          await host.close();
          if (owner === 0 && mode === 'off-during-switch') {
            notifyClosing();
            await closeGate;
          }
        },
        reserveLocal: () => Promise.resolve({ release: () => Promise.resolve() }),
        command: (_caller, input) => {
          const command = input as PeerCommand;
          commands.push({ owner, command });
          if (command.action === 'share') {
            if (mode === 'failed-share')
              return Promise.resolve({ ok: false, error: 'SHARING_FAILED' });
            state.sharing = true;
            state.gpuIds = command.gpuIds;
          } else if (command.action === 'stop-sharing') state.sharing = false;
          return Promise.resolve({
            ok: true,
            view: {
              fingerprint: 'a'.repeat(64),
              name: 'worker',
              sharing: state.sharing,
              sharedGpuIds: state.gpuIds,
              addresses: ['100.69.84.91'],
              gpus: [{ id: gpuId, name: 'GPU', memoryBytes: 12 * 2 ** 30 }],
              incoming: [],
              outgoing: [],
            },
          } satisfies PeerReply);
        },
      };
    });
    const fixture = JSON.parse(
      await readFile(new URL('../../tests/vulkan-inventories.json', import.meta.url), 'utf8'),
    ) as { vulkan: unknown };
    const inventory = parseInventory(fixture.vulkan);
    const deps = developmentDesktopDependencies(
      vi.fn(),
      path.join(root, 'b11306'),
      root,
      'window',
      root,
      undefined,
      undefined,
      path.join(root, 'runtimes'),
    );
    try {
      await deps.peers({ action: 'share', address: '100.69.84.91', gpuIds: [gpuId] });
      if (mode === 'off') await deps.peers({ action: 'stop-sharing' });
      await startup.verify.withImplementation(
        () => Promise.resolve('verified'),
        async () => {
          await startup.evidence.withImplementation(
            () => ({ inventory }),
            async () => {
              await deps.selectRuntime('b11306-vulkan');
              const switching = deps.activateRuntime();
              if (mode === 'off-during-switch') {
                await closing;
                const stopped = deps.peers({ action: 'stop-sharing' });
                releaseClose();
                await switching;
                await stopped;
              } else await switching;
            },
          );
        },
      );
      expect(startup.closePeers).toHaveBeenCalledOnce();
      expect(owners).toHaveLength(2);
      expect(owners[1]?.sharing).toBe(mode === 'on');
      expect(
        commands.filter((item) => item.owner === 1 && item.command.action === 'share'),
      ).toEqual(
        mode === 'on' || mode === 'off-during-switch'
          ? [{ owner: 1, command: { action: 'share', address: '100.69.84.91', gpuIds: [gpuId] } }]
          : [],
      );
    } finally {
      await deps.closePeers();
      vi.mocked(createDesktopPeerHost).mockImplementation(factory);
      await rm(root, { recursive: true, force: true });
    }
  },
);

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
    undefined,
  );
  expect(startup.adapter).toHaveBeenCalledWith(
    installed,
    'approved.gguf',
    expect.objectContaining({ slots: 4 }),
    18478,
    expect.any(Function),
    undefined,
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

function pending<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function preparedChatFixture() {
  const dependencies = developmentDesktopDependencies(
    () => {
      throw new Error('UNEXPECTED_FORK');
    },
    'unused',
    'trusted-profile',
    'captured-window',
  );
  const host = await dependencies.createHistoryHost();
  const cancelled = { status: 'cancelled' as const, reason: 'USER_CANCELLED' as const };
  const generated = pending<typeof cancelled>();
  const counted = pending<number>();
  const native = {
    tokenCount: vi.fn(() => counted.promise),
    start: vi.fn(() => ({
      settled: generated.promise,
      cancel: vi.fn(() => generated.resolve(cancelled)),
    })),
  };
  const engine = {
    selection: {
      deploymentId: dependencies.deploymentId,
      packageId: dependencies.packageId,
      modelId: dependencies.expectedHash,
      sessionId: 'session',
      operationId: 'load',
    },
    exited: Promise.resolve({ code: 0, signal: null }),
    waitReady: () => Promise.resolve(),
    requestStop: () => Promise.resolve(),
    forceStop: () => Promise.resolve(),
  };
  startup.verify.mockResolvedValueOnce('verified');
  startup.install.mockResolvedValueOnce({});
  startup.adapter.mockReturnValueOnce({
    chat: () => native,
    close: () => Promise.resolve(),
  });
  await host.prepare('approved.gguf');
  const transport = startup.deployment!.chat!(engine);
  const identity = {
    kind: 'api' as const,
    deploymentId: dependencies.deploymentId,
    sessionId: 'session',
    operationId: 'load',
    callerId: 'http',
    requestId: 'request',
  };
  return { dependencies, host, transport, native, counted, cancelled, identity };
}

it('finishes active generation cancellation after peer Quit admission closes', async () => {
  const fixture = await preparedChatFixture();
  try {
    const execution = fixture.transport.start(fixture.identity, [], () => undefined);
    await vi.waitFor(() => expect(fixture.native.start).toHaveBeenCalledOnce());
    await fixture.dependencies.beginPeerQuit();
    await execution.cancel();
    await expect(execution.settled).resolves.toEqual(fixture.cancelled);
    expect(startup.setRuntimeBusy.mock.calls).toEqual([[true], [false]]);
  } finally {
    await fixture.host.close();
    await fixture.dependencies.closePeers();
  }
});

it('finishes pending token counting after peer Quit admission closes', async () => {
  const fixture = await preparedChatFixture();
  try {
    const counted = fixture.transport.tokenCount([], new AbortController().signal);
    await vi.waitFor(() => expect(fixture.native.tokenCount).toHaveBeenCalledOnce());
    await fixture.dependencies.beginPeerQuit();
    fixture.counted.resolve(3);
    await expect(counted).resolves.toBe(3);
    expect(startup.setRuntimeBusy.mock.calls).toEqual([[true], [false]]);
  } finally {
    await fixture.host.close();
    await fixture.dependencies.closePeers();
  }
});

it('rejects first use of a retained chat transport after peer Quit begins', async () => {
  const fixture = await preparedChatFixture();
  try {
    await fixture.dependencies.beginPeerQuit();
    const execution = fixture.transport.start(fixture.identity, [], () => undefined);
    await expect(execution.settled).rejects.toThrow('NOT_READY');
    expect(fixture.native.start).not.toHaveBeenCalled();
    expect(startup.setRuntimeBusy).not.toHaveBeenCalled();
  } finally {
    await fixture.host.close();
    await fixture.dependencies.closePeers();
  }
});

it('reads the approved runtime without hashing installed payloads or installing', async () => {
  const deps = developmentDesktopDependencies(vi.fn(), 'bootstrap', undefined, undefined, 'state');
  const capability = { packageId: 'llama-cuda-development' };
  startup.verify.mockResolvedValueOnce(capability).mockResolvedValueOnce(capability);
  await expect(deps.runtimeSelection()).resolves.toEqual(runtimeDescription);
  expect(startup.findInstalled).not.toHaveBeenCalled();
  startup.hasInstalled.mockResolvedValueOnce(false);
  await expect(deps.runtimeInventory()).resolves.toEqual({
    selected: runtimeDescription,
    installed: false,
  });
  expect(startup.hasInstalled).toHaveBeenCalledWith(capability, path.join('state', 'installed'));
  expect(startup.findInstalled).not.toHaveBeenCalled();
  expect(startup.install).not.toHaveBeenCalled();
});

it('shares the installed runtime index across concurrent reads and settings revisits', async () => {
  const deps = developmentDesktopDependencies(vi.fn(), 'bootstrap', undefined, undefined, 'state');
  startup.verify.mockResolvedValue({ packageId: 'llama-cuda-development' });
  startup.hasInstalled.mockResolvedValue(true);
  const results = await Promise.all([deps.runtimeInventory(), deps.runtimeInventory()]);
  expect(results[0]).toEqual({ selected: runtimeDescription, installed: true });
  expect(results[1]).toEqual(results[0]);
  await deps.runtimeInventory();
  expect(startup.verify).toHaveBeenCalledTimes(1);
  expect(startup.hasInstalled).toHaveBeenCalledTimes(1);
  expect(startup.findInstalled).not.toHaveBeenCalled();
  expect(startup.install).not.toHaveBeenCalled();
});

it('refreshes the display index after installation or removal changes its directory', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'modelloom-inventory-'));
  try {
    const deps = developmentDesktopDependencies(vi.fn(), 'bootstrap', undefined, undefined, root);
    startup.verify.mockResolvedValue({ packageId: 'llama-cuda-development' });
    startup.hasInstalled.mockResolvedValue(false);
    expect((await deps.runtimeInventory()).installed).toBe(false);
    await mkdir(path.join(root, 'installed'));
    startup.hasInstalled.mockResolvedValue(true);
    expect((await deps.runtimeInventory()).installed).toBe(true);
    const changed = new Date(Date.now() + 2000);
    await utimes(path.join(root, 'installed'), changed, changed);
    startup.hasInstalled.mockResolvedValue(false);
    expect((await deps.runtimeInventory()).installed).toBe(false);
    expect(startup.hasInstalled).toHaveBeenCalledTimes(3);
    expect(startup.findInstalled).not.toHaveBeenCalled();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
