import { afterEach, expect, it, vi } from 'vitest';
const setup = vi.hoisted(() => {
  const uuid = 'GPU-22c23971-dacf-2123-2169-ad70d8f6729a';
  const config = {
    modelSha256: 'a'.repeat(64),
    contextPerSlot: 7680,
    slots: 1,
    gpuLayers: 48,
    gpuDevice: uuid,
    cacheK: 'f16' as const,
    cacheV: 'f16' as const,
    seed: 7,
    temperature: 0.8,
  };
  const inventory = {
    upstreamCommit: '4f31296a907d73f3409f720429bcf31111615d77',
    artifact: 'reviewed-cuda',
    backend: 'cuda',
    minimumDriver: '600.0',
    packageId: 'selected',
    helper: 'helper.exe',
    entrypoint: 'llama-server.exe',
  };
  const report = {
    modelSha256: config.modelSha256,
    artifact: inventory.artifact,
    backend: 'cuda',
    configuration: config,
    contextLimit: 262144,
    weights: { ram: 1, vram: 1 },
    kv: { ram: 1, vram: 1 },
    scratch: { ram: 1, vram: 1 },
    serverCaches: { promptCacheMiB: 768, contextCheckpoints: 2, ram: 768 * 1048576 },
    uncertainty: null,
    deviceVram: [{ uuid, bytes: 3 }],
  };
  const gpu = {
    uuid,
    bus: '00000000:04:00.0',
    driver: '617.14',
    total: 100,
    free: 100,
    mig: '[N/A]',
    driverModel: 'WDDM',
  };
  return {
    config,
    inventory,
    report,
    realm: 'live',
    developmentBuild: false,
    productionReports: [report],
    developmentReports: [report],
    snapshot: { ram: 768 * 1048576 + 100, gpus: [gpu], gpuQuery: 'OK' },
    discover: vi.fn(),
    launch: vi.fn(),
    stopped: false,
    release: vi.fn(),
  };
});
// Test-only approved inputs. Production catalogues remain unprovisioned.
vi.mock('../runtime-package/trust-policy.js', () => ({
  APPROVED_MEMORY_REPORTS: setup.productionReports,
}));
vi.mock('../runtime-package/development-policy.js', () => ({
  get DEVELOPMENT_BUILD() {
    return setup.developmentBuild;
  },
  DEVELOPMENT_MEMORY_REPORTS: setup.developmentReports,
}));
vi.mock('../runtime-package/install.js', () => ({
  installedRealm: () => setup.realm,
  requireInstalledLive: () => setup.inventory,
  revalidateInstalled: () => Promise.resolve({ release: setup.release }),
}));
vi.mock('../runtime/gguf.js', () => ({
  inspectGGUF: () => Promise.resolve({ sha256: setup.config.modelSha256, contextLimit: 262144 }),
}));
vi.mock('./resource-probe.js', () => ({ discoverResources: setup.discover }));
vi.mock('./windows-ownership.js', () => ({
  confirmExit: () => Promise.resolve(),
  ownershipBinding: () => ({
    createDeployment: () => ({}),
    sealFiles: () => ({}),
    releaseFiles: vi.fn(),
    privateDirectory: (directory: string) => mkdirSync(directory, { recursive: true }),
    availableMemory: () => 100,
    launchCudaConsole: setup.launch,
    launchConsole: () => {
      throw new Error('UNEXPECTED_CPU_LAUNCH');
    },
    captureServer: vi.fn(),
    release: vi.fn(),
    forceStop: () => {
      setup.stopped = true;
    },
    observe: () => ({
      output: 'ENGINE 100\n',
      exitCode: setup.stopped ? 0 : -1,
      activeProcesses: setup.stopped ? 0 : 1,
    }),
    closeDeployment: () => {
      setup.stopped = true;
    },
    coresExited: () => setup.stopped,
  }),
}));
import { realEngineAdapter } from './real-engine.js';
import type { PlannerReport } from '../runtime/preflight.js';
import { APPROVED_MEMORY_REPORTS } from '../runtime-package/trust-policy.js';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { mkdirSync } from 'node:fs';
const selection = {
  deploymentId: 'deployment',
  sessionId: 'session',
  operationId: 'operation',
  packageId: 'selected',
  modelId: setup.config.modelSha256,
};
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  setup.discover.mockReset();
  setup.launch.mockReset();
  setup.stopped = false;
  setup.realm = 'live';
  setup.developmentBuild = false;
  setup.productionReports.splice(0, setup.productionReports.length, setup.report);
});
async function adapter() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'modelloom-admission-'));
  directories.push(directory);
  return realEngineAdapter(
    { packageId: 'selected', directory: path.join(directory, 'runtime') },
    'model.gguf',
    setup.config,
    9999,
  );
}
it.each([
  ['live', true],
  ['development', false],
])(
  'never lends development memory authority to realm %s with development build %s',
  async (realm, enabled) => {
    setup.realm = String(realm);
    setup.developmentBuild = Boolean(enabled);
    setup.productionReports.splice(0);
    await expect(adapter()).rejects.toThrow('NEEDS_RESOURCE_EVIDENCE');
    expect(setup.launch).not.toHaveBeenCalled();
  },
);
it('admits a development report only with a development package and explicit build', async () => {
  setup.realm = 'development';
  setup.developmentBuild = true;
  setup.productionReports.splice(0);
  const instance = await adapter();
  await instance.close();
});
it.each([
  null,
  [{ ...setup.snapshot.gpus[0], free: 2 }],
  [{ ...setup.snapshot.gpus[0], driver: '500.0' }],
])(
  'samples CUDA resources afresh and rejects unavailable, short or incompatible devices before creation',
  async (gpus) => {
    setup.discover.mockResolvedValue({ ...setup.snapshot, gpus });
    const instance = await adapter();
    await expect(instance.launch(selection, new AbortController().signal)).rejects.toThrow(
      gpus === null
        ? 'NEEDS_RESOURCE_EVIDENCE'
        : gpus[0]?.driver === '500.0'
          ? 'INCOMPATIBLE_DRIVER'
          : 'INSUFFICIENT_RESOURCES',
    );
    expect(setup.discover).toHaveBeenCalledTimes(1);
    expect(setup.launch).not.toHaveBeenCalled();
    await instance.close();
  },
);
it('passes the same selected UUID to preflight and native creation, preserving exact context', async () => {
  setup.discover.mockResolvedValue(setup.snapshot);
  setup.launch.mockReturnValue({});
  const instance = await adapter();
  const engine = await instance.launch(selection, new AbortController().signal);
  expect(setup.launch.mock.calls[0]?.[4]).toBe(setup.config.gpuDevice);
  expect(setup.launch.mock.calls[0]?.[2]).toContain('7680');
  expect(Reflect.get(instance, 'children')?.()).toEqual([100]);
  await engine.forceStop();
  await engine.exited;
  await instance.close();
  expect((APPROVED_MEMORY_REPORTS[0] as PlannerReport).configuration).toEqual(setup.config);
});
it('rejects insufficient cache-inclusive RAM before creating an engine, even with enough VRAM', async () => {
  setup.discover.mockResolvedValue({ ...setup.snapshot, ram: setup.report.serverCaches.ram + 2 });
  const instance = await adapter();
  await expect(instance.launch(selection, new AbortController().signal)).rejects.toThrow(
    'INSUFFICIENT_RESOURCES',
  );
  expect(setup.launch).not.toHaveBeenCalled();
  await instance.close();
});
