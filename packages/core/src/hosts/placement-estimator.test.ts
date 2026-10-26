import { expect, it, vi } from 'vitest';
import { runPlacementEstimator, withPlacementModel } from './placement-estimator.js';
import { resolveClusterLoad } from '../cluster/effective-load.js';
import { record } from '../model-configuration/test-fixtures.js';
const f = vi.hoisted(() => ({
  forceStop: vi.fn(),
  release: vi.fn(),
  close: vi.fn(),
  unlock: vi.fn(),
  tick: 0,
  output: 'ENGINE 123\nCUDA0 100 2 3\nHost 1 0 0\n',
  cleanupOutput: '',
  capture: vi.fn(),
  cleanupFails: false,
  inspect: vi.fn(() =>
    Promise.resolve({ sha256: 'a'.repeat(64), contextLimit: 262144, blockCount: 64 }),
  ),
  seal: vi.fn(() => ({})),
  releaseModel: vi.fn(),
  launch: vi.fn(() => ({})),
  elapsed: 0,
  finishAt: 0,
}));
vi.mock('../runtime-package/install.js', () => ({
  requireInstalledLive: () => ({
    artifact: 'test',
    backend: 'cuda',
    upstreamCommit: '4f31296a907d73f3409f720429bcf31111615d77',
    helper: 'helper.exe',
    files: [{ path: 'llama-fit-params.exe' }],
  }),
  revalidateInstalled: () => Promise.resolve({ release: f.unlock }),
}));
vi.mock('../runtime/gguf.js', () => ({
  inspectGGUF: f.inspect,
}));
vi.mock('./windows-ownership.js', () => ({
  confirmExit: (done: () => boolean) => {
    expect(done()).toBe(true);
    if (f.cleanupFails) return Promise.reject(Error('fixture cleanup failed'));
    return Promise.resolve();
  },
  ownershipBinding: () => ({
    sealFiles: f.seal,
    releaseFiles: f.releaseModel,
    createDeployment: () => ({}),
    privateDirectory: () => {},
    launchCudaPlanConsole: f.launch,
    launchConsole: f.launch,
    captureServer: f.capture,
    forceStop: f.forceStop,
    release: f.release,
    closeDeployment: f.close,
    observe: () => {
      if (++f.tick === 1) {
        f.elapsed = f.finishAt;
        return { output: f.output, exitCode: -1, activeProcesses: 1 };
      }
      return { output: f.cleanupOutput, exitCode: 0, activeProcesses: 0 };
    },
  }),
}));
vi.mock('./peer-relays.js', () => ({
  createPeerRelays: () => Promise.resolve({ arguments: [], close: () => Promise.resolve() }),
}));
const saved = {
  id: '12345678-1234-4234-8234-123456789abc',
  name: 'Model',
  revision: 1,
  modelId: 'a'.repeat(64),
  profileId: 'test',
  blockCount: 64,
  load: { defaults: record().load, cacheK: 'q8_0' as const, cacheV: 'q8_0' as const },
  runs: [{ uuid: 'GPU-12345678-1234-1234-1234-123456789abc', first: 0, last: 63 }],
};
it.each(['local', 'remote', 'split'] as const)(
  'accepts strict estimate rows for %s allocations',
  async (kind) => {
    const original = f.output;
    const remote = `peer:${'b'.repeat(64)}:${saved.runs[0]!.uuid}`;
    const runs =
      kind === 'split'
        ? [
            { ...saved.runs[0]!, last: 30 },
            { uuid: remote, first: 31, last: 63 },
          ]
        : [{ ...saved.runs[0]!, uuid: kind === 'remote' ? remote : saved.runs[0]!.uuid }];
    f.tick = 0;
    f.output =
      'ENGINE 123\n' +
      (kind === 'remote'
        ? '0.00.159.351 E ggml_cuda_init: failed to initialize CUDA: no CUDA-capable device is detected\n'
        : '') +
      '0.01.122.865 I llama_fit_params: printing estimated memory in MiB to stdout (device, model, context, compute) ...\n' +
      (kind === 'local'
        ? 'CUDA0 100 2 3\n'
        : kind === 'remote'
          ? 'RPC0 100 2 3\n'
          : 'CUDA0 50 1 2\nRPC0 50 1 2\n') +
      'Host 1 0 0\n';
    try {
      await expect(
        runPlacementEstimator(
          { packageId: 'test', directory: 'E:\\fixture' },
          'E:\\model.gguf',
          'E:\\temp',
          resolveClusterLoad({ ...saved, runs }, 'test'),
          new AbortController().signal,
        ),
      ).resolves.toMatchObject({ orderedUuids: runs.map((run) => run.uuid) });
    } finally {
      f.output = original;
    }
  },
);
it.each(['local CUDA required', 'unknown diagnostic', 'missing row'])(
  'rejects invalid estimate diagnostics: %s',
  async (kind) => {
    const original = f.output;
    const remote = `peer:${'b'.repeat(64)}:${saved.runs[0]!.uuid}`;
    f.tick = 0;
    f.output =
      'ENGINE 123\n' +
      (kind === 'unknown diagnostic'
        ? 'unexpected warning\n'
        : '0.00.159.351 E ggml_cuda_init: failed to initialize CUDA: no CUDA-capable device is detected\n') +
      (kind === 'missing row'
        ? ''
        : kind === 'local CUDA required'
          ? 'CUDA0 100 2 3\n'
          : 'RPC0 100 2 3\n') +
      'Host 1 0 0\n';
    try {
      await expect(
        runPlacementEstimator(
          { packageId: 'test', directory: 'E:\\fixture' },
          'E:\\model.gguf',
          'E:\\temp',
          resolveClusterLoad(
            {
              ...saved,
              runs: [
                {
                  ...saved.runs[0]!,
                  uuid: kind === 'local CUDA required' ? saved.runs[0]!.uuid : remote,
                },
              ],
            },
            'test',
          ),
          new AbortController().signal,
        ),
      ).rejects.toThrow('INVALID_ESTIMATE');
    } finally {
      f.output = original;
    }
  },
);
it.each([
  ['remote', 35000, true],
  ['remote', 180000, true],
  ['remote', 1800000, false],
  ['local', 30000, false],
] as const)('bounds %s estimation at elapsed %i ms', async (kind, elapsed, succeeds) => {
  f.tick = 0;
  f.elapsed = 0;
  f.finishAt = elapsed;
  f.close.mockClear();
  const original = f.output;
  if (kind === 'remote') f.output = original.replace('CUDA0', 'RPC0');
  const now = vi.spyOn(Date, 'now').mockImplementation(() => f.elapsed);
  try {
    const load = resolveClusterLoad(
      {
        ...saved,
        runs: [
          {
            ...saved.runs[0]!,
            uuid:
              kind === 'remote'
                ? `peer:${'b'.repeat(64)}:${saved.runs[0]!.uuid}`
                : saved.runs[0]!.uuid,
          },
        ],
      },
      'test',
    );
    const work = runPlacementEstimator(
      { packageId: 'test', directory: 'E:\\fixture' },
      'E:\\model.gguf',
      'E:\\temp',
      load,
      new AbortController().signal,
    );
    if (succeeds) await expect(work).resolves.toMatchObject({ fingerprint: load.fingerprint });
    else await expect(work).rejects.toThrow('PLANNING_INCOMPLETE');
    expect(f.close).toHaveBeenCalled();
  } finally {
    now.mockRestore();
    f.finishAt = 0;
    f.output = original;
  }
});
it('retains bounded estimator diagnostics after a failed capture and confirmed cleanup', async () => {
  f.tick = 0;
  f.cleanupOutput = 'native estimator startup failed\n';
  const captureFailure = Error('OWNERSHIP_FAILED');
  f.capture.mockImplementationOnce(() => {
    throw captureFailure;
  });
  try {
    await expect(
      runPlacementEstimator(
        { packageId: 'test', directory: 'E:\\fixture' },
        'E:\\model.gguf',
        'E:\\temp',
        resolveClusterLoad(saved, 'test'),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      message: 'OWNERSHIP_FAILED',
      cause: captureFailure,
      estimatorOutput: f.output + f.cleanupOutput,
    });
  } finally {
    f.cleanupOutput = '';
  }
});
it('does not launch an estimator on a GPU reserved by another workload', async () => {
  f.launch.mockClear();
  const reserve = vi.fn(() => Promise.reject(Error('GPU_BUSY')));
  await expect(
    runPlacementEstimator(
      { packageId: 'test', directory: 'E:\\fixture' },
      'E:\\model.gguf',
      'E:\\temp',
      resolveClusterLoad(saved, 'test'),
      new AbortController().signal,
      undefined,
      undefined,
      reserve,
    ),
  ).rejects.toThrow('GPU_BUSY');
  expect(f.launch).not.toHaveBeenCalled();
});
it('releases an estimator reservation only after its native child has exited', async () => {
  f.tick = 0;
  const release = vi.fn(() => {
    expect(f.tick).toBeGreaterThan(1);
    return Promise.resolve();
  });
  const reserve = vi.fn(() => Promise.resolve({ release }));
  await runPlacementEstimator(
    { packageId: 'test', directory: 'E:\\fixture' },
    'E:\\model.gguf',
    'E:\\temp',
    resolveClusterLoad(saved, 'test'),
    new AbortController().signal,
    undefined,
    undefined,
    reserve,
  );
  expect(reserve).toHaveBeenCalledWith([saved.runs[0]!.uuid]);
  expect(release).toHaveBeenCalledTimes(1);
  f.tick = 0;
  f.cleanupFails = true;
  release.mockClear();
  try {
    await expect(
      runPlacementEstimator(
        { packageId: 'test', directory: 'E:\\fixture' },
        'E:\\model.gguf',
        'E:\\temp',
        resolveClusterLoad(saved, 'test'),
        new AbortController().signal,
        undefined,
        undefined,
        reserve,
      ),
    ).rejects.toThrow('CLEANUP_FAILED');
    expect(release).not.toHaveBeenCalled();
  } finally {
    f.cleanupFails = false;
  }
});
it('owns and joins the estimator, binding exact settings without admitting its result', async () => {
  f.tick = 0;
  const load = resolveClusterLoad(saved, 'test');
  const result = await runPlacementEstimator(
    { packageId: 'test', directory: 'E:\\fixture' },
    'E:\\model.gguf',
    'E:\\temp',
    load,
    new AbortController().signal,
  );
  expect(result.fingerprint).toBe(load.fingerprint);
  expect(f.close).toHaveBeenCalled();
  expect(f.release).toHaveBeenCalled();
  expect(f.unlock).toHaveBeenCalled();
});
it('rejects cancellation before creating a native child', async () => {
  await expect(
    runPlacementEstimator(
      { packageId: 'test', directory: 'E:\\fixture' },
      'E:\\model.gguf',
      'E:\\temp',
      resolveClusterLoad(saved, 'test'),
      AbortSignal.abort(),
    ),
  ).rejects.toThrow('PLANNING_CANCELLED');
});
it('settles an owned estimator on cancellation after capture', async () => {
  const abort = new AbortController();
  f.tick = 0;
  f.close.mockClear();
  f.capture.mockImplementationOnce(() => abort.abort());
  await expect(
    runPlacementEstimator(
      { packageId: 'test', directory: 'E:\\fixture' },
      'E:\\model.gguf',
      'E:\\temp',
      resolveClusterLoad(saved, 'test'),
      abort.signal,
    ),
  ).rejects.toThrow('PLANNING_CANCELLED');
  expect(f.close).toHaveBeenCalled();
});
it('rejects unexpected estimator output and retains locks if cleanup cannot be confirmed', async () => {
  f.tick = 0;
  f.unlock.mockClear();
  f.releaseModel.mockClear();
  f.cleanupFails = true;
  const original = f.output;
  f.output += 'Unexpected 1 2 3\n';
  try {
    await expect(
      runPlacementEstimator(
        { packageId: 'test', directory: 'E:\\fixture' },
        'E:\\model.gguf',
        'E:\\temp',
        resolveClusterLoad(saved, 'test'),
        new AbortController().signal,
      ),
    ).rejects.toThrow('CLEANUP_FAILED');
    expect(f.unlock).not.toHaveBeenCalled();
    expect(f.releaseModel).not.toHaveBeenCalled();
  } finally {
    f.cleanupFails = false;
    f.output = original;
  }
});
const estimateWith = (inspection?: object, model = 'E:\\model.gguf') =>
  runPlacementEstimator(
    { packageId: 'test', directory: 'E:\\fixture' },
    model,
    'E:\\temp',
    resolveClusterLoad(saved, 'test'),
    new AbortController().signal,
    inspection,
  );
it('releases the outer seal if inspection fails before minting a reusable token', async () => {
  f.releaseModel.mockClear();
  f.inspect.mockRejectedValueOnce(Error('INVALID_GGUF'));
  const callback = vi.fn();
  await expect(withPlacementModel('E:\\model.gguf', callback)).rejects.toThrow('INVALID_GGUF');
  expect(callback).not.toHaveBeenCalled();
  expect(f.releaseModel).toHaveBeenCalledTimes(1);
});
it.each([
  { sha256: 'a'.repeat(64), contextLimit: 1, blockCount: 64 },
  { sha256: 'a'.repeat(64), contextLimit: 262144, blockCount: 65 },
])('checks inspected context and allocation blocks against the requested load', async (info) => {
  f.inspect.mockResolvedValueOnce(info);
  await expect(estimateWith()).rejects.toThrow('INVALID_CONFIGURATION');
});
it('reuses inspection only inside the held outer seal while retaining estimator seals', async () => {
  f.inspect.mockClear();
  f.seal.mockClear();
  f.releaseModel.mockClear();
  await withPlacementModel('E:\\model.gguf', async (info, inspection) => {
    expect(info.sha256).toBe(saved.modelId);
    expect(f.releaseModel).not.toHaveBeenCalled();
    f.tick = 0;
    await estimateWith(inspection);
    f.tick = 0;
    await estimateWith(inspection);
    expect(f.inspect).toHaveBeenCalledTimes(1);
    expect(f.seal).toHaveBeenCalledTimes(3);
    expect(f.releaseModel).toHaveBeenCalledTimes(2);
  });
  expect(f.releaseModel).toHaveBeenCalledTimes(3);
});
it('rejects forged, expired and wrong-file inspection tokens without reinspection', async () => {
  f.inspect.mockClear();
  await expect(estimateWith(Object.freeze({}))).rejects.toThrow('INVALID_ESTIMATE');
  expect(f.inspect).not.toHaveBeenCalled();
  let expired: object | undefined;
  await withPlacementModel('E:\\model.gguf', async (_, inspection) => {
    expired = inspection;
    await expect(estimateWith(inspection, 'E:\\other.gguf')).rejects.toThrow('INVALID_ESTIMATE');
  });
  await expect(estimateWith(expired)).rejects.toThrow('INVALID_ESTIMATE');
  expect(f.inspect).toHaveBeenCalledTimes(1);
});
it('releases the outer model seal and expires its token on callback failure', async () => {
  f.releaseModel.mockClear();
  let expired: object | undefined;
  await expect(
    withPlacementModel('E:\\model.gguf', (_, inspection) => {
      expired = inspection;
      return Promise.reject(Error('callback failed'));
    }),
  ).rejects.toThrow('callback failed');
  expect(f.releaseModel).toHaveBeenCalledTimes(1);
  await expect(estimateWith(expired)).rejects.toThrow('INVALID_ESTIMATE');
});
