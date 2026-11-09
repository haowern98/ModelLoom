import path from 'node:path';
import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { resolveClusterLoad } from '../cluster/effective-load.js';
import { createStockClusterReport } from '../cluster/stock-profile.js';
import { record } from '../model-configuration/test-fixtures.js';
import { parseInventory } from '../runtime-package/inventory.js';
import type { PlannerReport } from '../runtime/preflight.js';

const inventories = JSON.parse(
  readFileSync(new URL('../../tests/vulkan-inventories.json', import.meta.url), 'utf8'),
) as { vulkan: unknown };
const vulkan = parseInventory(inventories.vulkan);

const state = vi.hoisted(() => ({
  discover: vi.fn(),
  launch: vi.fn(),
  stopped: false,
  release: vi.fn(),
  output: undefined as string | undefined,
  ready: vi.fn(),
  lost: undefined as (() => void) | undefined,
  forced: vi.fn(),
  vulkan: false,
  realm: 'development',
  releaseReports: [] as PlannerReport[],
}));
vi.mock('../runtime-package/trust-policy.js', () => ({
  APPROVED_MEMORY_REPORTS: state.releaseReports,
}));
vi.mock('./peer-relays.js', () => ({
  createPeerRelays: (
    _devices: readonly string[],
    _allowed: unknown,
    _open: unknown,
    lost?: () => void,
  ) => {
    state.lost = lost;
    return Promise.resolve({ arguments: [], physical: [], close: () => Promise.resolve() });
  },
}));
const uuid = 'GPU-22c23971-dacf-2123-2169-ad70d8f6729a';
vi.mock('../runtime-package/development-policy.js', () => ({
  DEVELOPMENT_BUILD: true,
  DEVELOPMENT_MEMORY_REPORTS: [],
}));
vi.mock('../runtime-package/install.js', () => ({
  installedRealm: () => state.realm,
  requireInstalledLive: () =>
    state.vulkan
      ? vulkan
      : {
          upstreamCommit: '4f31296a907d73f3409f720429bcf31111615d77',
          artifact: 'b11306-cuda12.4-msvc14.44-dev1',
          backend: 'cuda',
          packageId: 'llama-cuda-development',
          minimumDriver: '551.78',
          helper: 'helper.exe',
          entrypoint: 'llama-server.exe',
        },
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
    availableMemory: () => 32 * 2 ** 30,
    launchCudaPlanConsole: state.launch,
    captureServer: () => {},
    ownedListener: () => true,
    observe: () => {
      const output = state.output ?? 'ENGINE 100\n';
      if (state.output !== undefined) state.output = '';
      return {
        output,
        pid: 100,
        exitCode: state.stopped ? 0 : -1,
        activeProcesses: state.stopped ? 0 : 1,
      };
    },
    forceStop: () => {
      state.forced();
      state.stopped = true;
    },
    release: () => {},
    closeDeployment: () => {
      state.stopped = true;
    },
    coresExited: () => state.stopped,
  }),
}));
vi.mock('./readiness.js', () => ({ checkOwnedReadiness: state.ready }));
vi.mock('./slot-monitor.js', () => ({
  OwnedSlotMonitor: class {
    initialize() {
      return Promise.resolve();
    }
  },
}));
import { realEngineAdapter } from './real-engine.js';

afterEach(() => {
  state.stopped = false;
  state.output = undefined;
  state.ready.mockReset();
  state.discover.mockReset();
  state.launch.mockReset();
  state.lost = undefined;
  state.release.mockReset();
  state.vulkan = false;
  state.realm = 'development';
  state.releaseReports.length = 0;
});
function fixture(
  confirmMemory: () => Promise<boolean>,
  overflow: 'stop' | 'rolling' | 'truncate-middle' = 'stop',
) {
  const load = resolveClusterLoad(
    {
      id: '12345678-1234-4234-8234-123456789abc',
      name: 'test',
      revision: 1,
      modelId: 'a'.repeat(64),
      blockCount: 64,
      profileId: 'b11306-four-slot',
      load: {
        defaults: record().load,
        preferences: { ...record().preferences, overflow },
        cacheK: 'q8_0',
        cacheV: 'q8_0',
      },
      runs: [{ uuid, first: 0, last: 63 }],
    },
    state.vulkan ? vulkan.artifact : 'b11306-cuda12.4-msvc14.44-dev1',
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
    {
      packageId: state.vulkan ? 'llama-vulkan-development' : 'llama-cuda-development',
      directory: path.resolve('out/test-memory-runtime'),
    },
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
    packageId: state.vulkan ? 'llama-vulkan-development' : 'llama-cuda-development',
    modelId: load.modelSha256,
  };
  return { adapter, snapshot, selection };
}
it('uses placement-specific admission for a qualified release build on a different configuration', async () => {
  state.realm = 'live';
  state.vulkan = true;
  state.releaseReports.push({
    artifact: vulkan.artifact,
    backend: 'vulkan',
    configuration: { slots: 4, modelSha256: 'b'.repeat(64) },
    uncertainty: null,
  } as PlannerReport);
  const f = fixture(() => Promise.resolve(false));
  state.discover.mockResolvedValue(f.snapshot);
  try {
    await expect(f.adapter.launch(f.selection, new AbortController().signal)).rejects.toThrow(
      'START_FAILED',
    );
    expect(state.discover).toHaveBeenCalledOnce();
    expect(state.launch).not.toHaveBeenCalled();
  } finally {
    await f.adapter.close();
  }
});

it('rejects a release build with no independent qualification before probing resources', () => {
  state.realm = 'live';
  expect(() => fixture(() => Promise.resolve(false))).toThrow('NEEDS_RESOURCE_EVIDENCE');
  expect(state.discover).not.toHaveBeenCalled();
});
it('checks fresh GPU resources before launching a qualified Vulkan load', async () => {
  state.vulkan = true;
  const f = fixture(() => Promise.resolve(false));
  state.discover.mockResolvedValue({ ...f.snapshot, ram: 32 * 2 ** 30 });
  state.launch.mockReturnValue({});
  try {
    const engine = await f.adapter.launch(f.selection, new AbortController().signal);
    expect(state.discover).toHaveBeenCalledOnce();
    expect(state.launch).toHaveBeenCalledOnce();
    await engine.forceStop();
    await engine.exited;
  } finally {
    await f.adapter.close();
  }
});
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

it('invalidates a ready instance and confirms owned exit when a retained peer relay is lost', async () => {
  const f = fixture(() => Promise.resolve(true));
  state.discover.mockResolvedValue(f.snapshot);
  state.launch.mockReturnValue({});
  state.output = 'ENGINE 100\n' + allocationLog();
  state.ready.mockResolvedValue(4096);
  const engine = await f.adapter.launch(f.selection, new AbortController().signal);
  try {
    await engine.waitReady(new AbortController().signal);
    expect(state.stopped).toBe(false);
    expect(state.lost).toBeTypeOf('function');
    state.lost!();
    await engine.exited;
    expect(state.forced).toHaveBeenCalledOnce();
    expect(state.release).toHaveBeenCalledOnce();
    expect(f.adapter.children()).toEqual([]);
  } finally {
    await engine.forceStop();
    await engine.exited;
    await f.adapter.close();
  }
});

function allocationLog() {
  return [
    `llama_prepare_model_devices: using device CUDA0 (GPU) (0000:04:00.0) - 100 MiB free`,
    ...Array.from(
      { length: 65 },
      (_, i) => `load_tensors: layer ${i} assigned to device CUDA0, is_swa = 0`,
    ),
    'load_tensors: offloading output layer to GPU',
    'load_tensors: offloaded 65/65 layers to GPU',
    'load_tensors: CUDA0 model buffer size = 100.00 MiB',
    ...Array.from({ length: 64 }, (_, i) => `llama_kv_cache: layer ${i}: dev = CUDA0`),
    'llama_kv_cache: CUDA0 KV buffer size = 10.00 MiB',
    'srv llama_server: model loaded',
    '',
  ].join('\n');
}
it.each(['before-marker', 'partial-marker', 'partial-trailer'])(
  'waits for the complete allocation log after HTTP readiness (%s)',
  async (mode) => {
    const f = fixture(() => Promise.resolve(true));
    state.discover.mockResolvedValue(f.snapshot);
    state.launch.mockReturnValue({});
    const log = allocationLog();
    const cut =
      mode === 'before-marker'
        ? log.indexOf('srv llama_server:')
        : mode === 'partial-marker'
          ? log.length - 3
          : log.length;
    state.output =
      'ENGINE 100\n' + log.slice(0, cut) + (mode === 'partial-trailer' ? 'next par' : '');
    const engine = await f.adapter.launch(f.selection, new AbortController().signal);
    state.output = '';
    let first = true;
    state.ready.mockImplementation(() => {
      if (first) {
        first = false;
        // Deliver the remaining native chunk only after the first readiness attempt.
        setTimeout(() => {
          state.output = log.slice(cut) + (mode === 'partial-trailer' ? 'tial line\n' : '');
        }, 15);
      }
      return Promise.resolve();
    });
    try {
      await expect(engine.waitReady(new AbortController().signal)).resolves.toBeUndefined();
      expect(state.ready.mock.calls.length).toBeGreaterThan(1);
    } finally {
      await engine.forceStop();
      await engine.exited;
      await f.adapter.close();
    }
  },
);

it.each(['mismatch', 'cancel'] as const)('does not admit %s allocation evidence', async (mode) => {
  const f = fixture(() => Promise.resolve(true));
  state.discover.mockResolvedValue(f.snapshot);
  state.launch.mockReturnValue({});
  state.output =
    'ENGINE 100\n' +
    (mode === 'mismatch'
      ? allocationLog().replace(
          'layer 0 assigned to device CUDA0',
          'layer 0 assigned to device CPU',
        )
      : 'load_tensors: pending\n');
  const engine = await f.adapter.launch(f.selection, new AbortController().signal);
  state.ready.mockResolvedValue(undefined);
  const abort = new AbortController();
  if (mode === 'cancel') setTimeout(() => abort.abort(), 30);
  try {
    await expect(engine.waitReady(abort.signal)).rejects.toThrow(
      mode === 'mismatch' ? 'PLACEMENT_MISMATCH' : 'START_TIMEOUT',
    );
  } finally {
    await engine.forceStop();
    await engine.exited;
    await f.adapter.close();
  }
});

it('confirms owned exit after an unsupported startup warning instead of repeating the fault', async () => {
  vi.useFakeTimers();
  const f = fixture(() => Promise.resolve(true), 'rolling');
  state.discover.mockResolvedValue(f.snapshot);
  state.launch.mockReturnValue({});
  state.output =
    'ENGINE 100\ncommon_init_: KV cache shifting is not supported for this context, disabling KV cache shifting\n';
  try {
    const engine = await f.adapter.launch(f.selection, new AbortController().signal);
    await expect(engine.waitReady(new AbortController().signal)).rejects.toThrow(
      'UNSUPPORTED_SETTING',
    );
    await vi.advanceTimersByTimeAsync(20);
    expect(await Promise.race([engine.exited, Promise.resolve('NO_EXIT_RECEIPT')])).toEqual({
      code: 0,
      signal: null,
    });
    expect(f.adapter.children()).toEqual([]);
  } finally {
    vi.clearAllTimers();
    vi.useRealTimers();
    await f.adapter.close();
  }
});
