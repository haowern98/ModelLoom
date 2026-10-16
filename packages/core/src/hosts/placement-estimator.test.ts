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
  capture: vi.fn(),
  cleanupFails: false,
  inspect: vi.fn(() =>
    Promise.resolve({ sha256: 'a'.repeat(64), contextLimit: 262144, blockCount: 64 }),
  ),
  seal: vi.fn(() => ({})),
  releaseModel: vi.fn(),
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
    launchCudaPlanConsole: () => ({}),
    captureServer: f.capture,
    forceStop: f.forceStop,
    release: f.release,
    closeDeployment: f.close,
    observe: () =>
      ++f.tick === 1
        ? { output: f.output, exitCode: -1, activeProcesses: 1 }
        : { output: '', exitCode: 0, activeProcesses: 0 },
  }),
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
