import { expect, it, vi } from 'vitest';
import { mkdirSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { DEVELOPMENT_MEMORY_REPORTS } from '../runtime-package/development-policy.js';
import { realEngineAdapter } from './real-engine.js';
import type * as DevelopmentPolicy from '../runtime-package/development-policy.js';

const native = vi.hoisted(() => ({
  tick: 0,
  force: vi.fn(),
  release: vi.fn(),
  child: vi.fn(),
  files: vi.fn(),
  capture: vi.fn(),
}));
vi.mock('../runtime-package/development-policy.js', async (original) => ({
  ...(await original<typeof DevelopmentPolicy>()),
  DEVELOPMENT_BUILD: true,
}));
vi.mock('../runtime-package/install.js', () => ({
  installedRealm: () => 'development',
  requireInstalledLive: () => ({
    packageId: 'llama-cuda-development',
    upstreamCommit: '4f31296a907d73f3409f720429bcf31111615d77',
    artifact: 'b11306-cuda12.4-msvc14.44-dev1',
    backend: 'cuda',
    minimumDriver: '551.78',
    entrypoint: 'llama-server.exe',
    helper: 'ModelLoom-runtime-host.exe',
  }),
  revalidateInstalled: () => Promise.resolve({ release: native.files }),
}));
vi.mock('../runtime/gguf.js', () => ({
  inspectGGUF: () =>
    Promise.resolve({
      sha256: '71d6871836886267f39f1ac69b1b1dd8a783970708d7a189960112ed02978901',
      contextLimit: 262144,
    }),
}));
vi.mock('./resource-probe.js', () => ({
  discoverResources: () =>
    Promise.resolve({
      ram: 24 * 2 ** 30,
      gpus: [
        {
          uuid: 'GPU-22c23971-dacf-2123-2169-ad70d8f6729a',
          driver: '617.14',
          total: 16 * 2 ** 30,
          free: 16 * 2 ** 30,
          mig: '[N/A]',
          driverModel: 'WDDM',
        },
      ],
    }),
}));
vi.mock('./windows-ownership.js', () => ({
  ownershipBinding: () => ({
    createDeployment: () => ({}),
    createCredential: () => ({}),
    credentialPath: () => '\\\\.\\pipe\\ModelLoom-fixture',
    deliverCredential: () => true,
    releaseCredential: vi.fn(),
    sealFiles: () => ({}),
    releaseFiles: native.release,
    privateDirectory: (directory: string) => mkdirSync(directory),
    launchCudaConsole: () => ({}),
    observe: () =>
      ++native.tick === 1
        ? { pid: 42, output: 'ENGINE 123\n', exitCode: -1, activeProcesses: 2 }
        : { pid: 42, output: '', exitCode: 1, activeProcesses: 0 },
    captureServer: () => {
      native.capture();
      throw new Error('OWNERSHIP_FAILED');
    },
    forceStop: native.force,
    closeDeployment: () => undefined,
    coresExited: () => true,
    release: native.child,
  }),
  confirmExit: (done: () => boolean) =>
    done() ? Promise.resolve() : Promise.reject(new Error('CLEANUP_FAILED')),
}));

it('confirms failed startup exit after rejecting a capture instead of retrying the dead receipt forever', async () => {
  const directory = await mkdtemp(path.resolve('out/failed-capture-'));
  if (!directory.startsWith(path.resolve('out') + path.sep)) throw new Error('Unsafe test cleanup');
  const report = DEVELOPMENT_MEMORY_REPORTS.find((entry) => entry.configuration.slots === 4)!;
  const adapter = realEngineAdapter(
    { packageId: 'llama-cuda-development', directory: path.join(directory, 'installed') },
    'approved.gguf',
    report.configuration,
    18478,
  );
  const engine = await adapter.launch(
    {
      deploymentId: 'test',
      packageId: 'llama-cuda-development',
      modelId: report.modelSha256,
      sessionId: 's',
      operationId: 'o',
    },
    new AbortController().signal,
  );
  try {
    const outcome = await Promise.race([
      engine.exited,
      new Promise((resolve) => setTimeout(() => resolve('NO_EXIT_RECEIPT'), 150)),
    ]);
    expect(outcome).toEqual({ code: 1, signal: null });
    expect(native.capture).toHaveBeenCalledTimes(1);
    expect(native.force).toHaveBeenCalledTimes(1);
    expect(native.release).toHaveBeenCalledTimes(1);
  } finally {
    vi.clearAllTimers();
    await adapter.close().catch(() => undefined);
    await rm(directory, { recursive: true });
  }
});
