import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { resolveClusterLoad } from '../cluster/effective-load.js';
import { createStockClusterReport } from '../cluster/stock-profile.js';
import { record } from '../model-configuration/test-fixtures.js';

const state = vi.hoisted(() => ({
  discover: vi.fn(),
  launch: vi.fn(),
  stopped: false,
  release: vi.fn(),
}));
const uuid = 'GPU-22c23971-dacf-2123-2169-ad70d8f6729a';
vi.mock('../runtime-package/development-policy.js', () => ({
  DEVELOPMENT_BUILD: true,
  DEVELOPMENT_MEMORY_REPORTS: [],
}));
vi.mock('../runtime-package/install.js', () => ({
  installedRealm: () => 'development',
  requireInstalledLive: () => ({
    upstreamCommit: '4f31296a907d73f3409f720429bcf31111615d77',
    artifact: 'b11306-cuda12.4-msvc14.44-dev1',
    backend: 'cuda',
    packageId: 'llama-cuda-development',
    minimumDriver: '551.78',
    helper: 'helper.exe',
    entrypoint: 'llama-server.exe',
  }),
  revalidateInstalled: () => Promise.resolve({ release: state.release }),
}));
vi.mock('../runtime/gguf.js', () => ({
  inspectGGUF: () =>
    Promise.resolve({ sha256: 'a'.repeat(64), contextLimit: 32768, blockCount: 64 }),
}));
vi.mock('./resource-probe.js', () => ({ discoverResources: state.discover }));
vi.mock('./windows-ownership.js', () => ({
  confirmExit: async () => {},
  ownershipBinding: () => ({
    createDeployment: () => ({}),
    createCredential: () => ({}),
    credentialPath: () => 'private-key',
    releaseCredential: () => {},
    deliverCredential: () => true,
    sealFiles: () => ({}),
    releaseFiles: () => {},
    privateDirectory: () => {},
    launchCudaPlanConsole: state.launch,
    captureServer: () => {},
    observe: () => ({
      output: 'ENGINE 100\n',
      pid: 100,
      exitCode: state.stopped ? 0 : -1,
      activeProcesses: state.stopped ? 0 : 1,
    }),
    forceStop: () => {
      state.stopped = true;
    },
    release: () => {},
    closeDeployment: () => {
      state.stopped = true;
    },
    coresExited: () => state.stopped,
  }),
}));
import { realEngineAdapter } from './real-engine.js';

afterEach(() => {
  state.stopped = false;
  state.discover.mockReset();
  state.launch.mockReset();
  state.release.mockReset();
});
function fixture(confirmMemory: () => Promise<boolean>) {
  const load = resolveClusterLoad(
    {
      id: '12345678-1234-4234-8234-123456789abc',
      name: 'test',
      revision: 1,
      modelId: 'a'.repeat(64),
      blockCount: 64,
      profileId: 'b11306-four-slot',
      load: { defaults: record().load, cacheK: 'q8_0', cacheV: 'q8_0' },
      runs: [{ uuid, first: 0, last: 63 }],
    },
    'b11306-cuda12.4-msvc14.44-dev1',
  );
  const budget = createStockClusterReport(load, {
    fingerprint: load.fingerprint,
    orderedUuids: [uuid],
    host: { model: 100, context: 100, compute: 100 },
    devices: [{ uuid, model: 100, context: 100, compute: 100 }],
  });
  const config = {
    modelSha256: load.modelSha256,
    contextPerSlot: load.contextPerSlot,
    slots: load.slots,
    gpuLayers: 65,
    gpuDevice: uuid,
    cacheK: load.cacheK,
    cacheV: load.cacheV,
    seed: 7,
    temperature: 0.8,
  };
  const adapter = realEngineAdapter(
    { packageId: 'llama-cuda-development', directory: path.resolve('out/test-memory-runtime') },
    'model.gguf',
    config,
    9999,
    () => false,
    { load, report: budget, confirmMemory },
  );
  const snapshot = {
    ram: 0,
    gpus: [
      {
        uuid,
        bus: '0000:04:00.0',
        free: 32 * 2 ** 30,
        total: 32 * 2 ** 30,
        driver: '617.14',
        driverModel: 'WDDM',
        mig: '[N/A]',
      },
    ],
  };
  const selection = {
    deploymentId: 'd',
    sessionId: 's',
    operationId: 'o',
    packageId: 'llama-cuda-development',
    modelId: load.modelSha256,
  };
  return { adapter, snapshot, selection };
}
it('warns about a shortage discovered at final creation and rechecks before admitted launch', async () => {
  const confirm = vi.fn(() => Promise.resolve(true));
  const f = fixture(confirm);
  state.discover.mockResolvedValue(f.snapshot);
  state.launch.mockReturnValue({});
  const engine = await f.adapter.launch(f.selection, new AbortController().signal);
  expect(confirm).toHaveBeenCalledOnce();
  expect(state.discover).toHaveBeenCalledTimes(2);
  expect(state.launch).toHaveBeenCalledOnce();
  await engine.forceStop();
  await engine.exited;
  await f.adapter.close();
});
it.each(['cancel', 'abort', 'driver'] as const)(
  'creates no native engine after %s at the final warning',
  async (mode) => {
    const abort = new AbortController();
    const confirm = vi.fn(() => {
      if (mode === 'abort') abort.abort();
      return Promise.resolve(mode !== 'cancel');
    });
    const f = fixture(confirm);
    state.discover.mockResolvedValueOnce(f.snapshot).mockResolvedValue({
      ...f.snapshot,
      gpus: f.snapshot.gpus.map((g) => ({ ...g, driver: '500.0' })),
    });
    await expect(f.adapter.launch(f.selection, abort.signal)).rejects.toThrow(
      mode === 'driver' ? 'INCOMPATIBLE_DRIVER' : 'START_FAILED',
    );
    expect(confirm).toHaveBeenCalledOnce();
    expect(state.launch).not.toHaveBeenCalled();
    expect(state.release).toHaveBeenCalledOnce();
    await f.adapter.close();
  },
);
