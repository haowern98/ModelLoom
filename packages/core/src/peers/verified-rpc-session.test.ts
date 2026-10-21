import { Duplex } from 'node:stream';
import { beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({
  release: vi.fn(),
  open: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
}));
vi.mock('../runtime-package/install.js', () => ({
  requireInstalledLive: () => ({
    backend: 'cuda',
    protocol: 1,
    upstreamCommit: '4f31296a907d73f3409f720429bcf31111615d77',
    files: [
      'ModelLoom-peer-host.exe',
      'ggml-rpc-server.exe',
      'ggml.dll',
      'ggml-base.dll',
      'ggml-cpu-x64.dll',
      'ggml-cuda.dll',
      'ggml-rpc.dll',
      'cublas64_12.dll',
      'cublasLt64_12.dll',
      'cudart64_12.dll',
      'libomp.dll',
      'msvcp140.dll',
      'vcruntime140.dll',
      'vcruntime140_1.dll',
    ].map((path) => ({ path })),
  }),
  revalidateInstalled: () => Promise.resolve({ release: fixture.release }),
}));
vi.mock('./rpc-relay.js', () => ({ launchOwnedRpcSession: fixture.open }));
import { VerifiedRpcBackend } from './verified-rpc.js';
const gpu = 'GPU-11111111-1111-1111-1111-111111111111';
beforeEach(() => {
  vi.clearAllMocks();
  fixture.open.mockResolvedValue({ start: fixture.start, close: fixture.stop });
  fixture.start.mockResolvedValue({ stream: new Duplex({ read() {} }), close: async () => {} });
  fixture.stop.mockResolvedValue(undefined);
});
const backend = () =>
  new VerifiedRpcBackend(() =>
    Promise.resolve({
      packageId: 'test',
      directory: 'E:\\verified-fixture',
    }),
  );

it('elevates once on sharing and retains installation seals across multiple workers', async () => {
  const value = backend();
  await expect(value.start([gpu])).rejects.toThrow('RPC_SHARING_REQUIRED');
  await value.openSharing([gpu]);
  for (let i = 0; i < 3; i++) await (await value.start([gpu])).close();
  expect(fixture.open).toHaveBeenCalledTimes(1);
  expect(fixture.start).toHaveBeenCalledTimes(3);
  expect(fixture.release).not.toHaveBeenCalled();
  await value.closeSharing();
  expect(fixture.stop).toHaveBeenCalledTimes(1);
  expect(fixture.release).toHaveBeenCalledTimes(1);
  await expect(value.start([gpu])).rejects.toThrow('RPC_SHARING_REQUIRED');
});

it('never re-elevates for a changed GPU or broken worker', async () => {
  const value = backend();
  await value.openSharing([gpu]);
  await expect(value.start(['GPU-22222222-2222-2222-2222-222222222222'])).rejects.toThrow(
    'INVALID_GPU_RESERVATION',
  );
  fixture.start.mockRejectedValueOnce(new Error('RPC_UNAVAILABLE'));
  await expect(value.start([gpu])).rejects.toThrow('RPC_UNAVAILABLE');
  expect(fixture.open).toHaveBeenCalledTimes(1);
  await value.closeSharing();
});

it('retains seals and refuses restart after unconfirmed helper shutdown', async () => {
  const value = backend();
  await value.openSharing([gpu]);
  fixture.stop
    .mockRejectedValueOnce(new Error('RPC_CLEANUP_FAILED'))
    .mockRejectedValueOnce(new Error('RPC_CLEANUP_FAILED'));
  await expect(value.closeSharing()).rejects.toThrow('RPC_CLEANUP_FAILED');
  expect(fixture.release).not.toHaveBeenCalled();
  await expect(value.openSharing([gpu])).rejects.toThrow('RPC_CLEANUP_FAILED');
  expect(fixture.open).toHaveBeenCalledTimes(1);
  fixture.stop.mockRejectedValueOnce(Error('RPC_CLEANUP_FAILED'));
  await expect(value.closeSharing()).rejects.toThrow('RPC_CLEANUP_FAILED');
  expect(fixture.release).not.toHaveBeenCalled();
  await expect(value.closeSharing()).resolves.toBeUndefined();
  expect(fixture.release).toHaveBeenCalledTimes(1);
  await value.openSharing([gpu]);
  expect(fixture.open).toHaveBeenCalledTimes(2);
  await value.closeSharing();
});
