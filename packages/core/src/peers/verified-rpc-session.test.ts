import { Duplex } from 'node:stream';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({
  release: vi.fn(),
  open: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  network: vi.fn(),
  ConfirmedNetworkSetupFailure: class extends Error {
    constructor() {
      super('SHARING_PERMISSION_REQUIRED');
    }
  },
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
vi.mock('./rpc-relay.js', () => ({
  launchOwnedRpcSession: fixture.open,
  launchOwnedSharingNetwork: fixture.network,
  ConfirmedNetworkSetupFailure: fixture.ConfirmedNetworkSetupFailure,
}));
import { VerifiedRpcBackend } from './verified-rpc.js';
const gpu = 'GPU-11111111-1111-1111-1111-111111111111';
const secondGpu = 'GPU-22222222-2222-2222-2222-222222222222';
afterEach(() => vi.useRealTimers());
beforeEach(() => {
  vi.clearAllMocks();
  fixture.open.mockResolvedValue({ start: fixture.start, close: fixture.stop });
  fixture.start.mockResolvedValue({ stream: new Duplex({ read() {} }), close: async () => {} });
  fixture.stop.mockResolvedValue(undefined);
});

it('opens one admitted sharing network with the remaining total approval budget', async () => {
  vi.useFakeTimers({ toFake: ['performance'] });
  const value = backend();
  await expect(value.openNetwork('100.77.238.117', vi.fn())).rejects.toThrow(
    'RPC_SHARING_REQUIRED',
  );
  fixture.open.mockImplementationOnce(() => {
    vi.advanceTimersByTime(20000);
    return Promise.resolve({ start: fixture.start, close: fixture.stop });
  });
  const stream = new Duplex({ read() {} });
  const close = vi.fn(() => Promise.resolve());
  fixture.network.mockResolvedValueOnce({ stream, close });
  await value.openSharing([gpu]);
  await value.openNetwork('100.77.238.117', vi.fn());
  expect(fixture.network).toHaveBeenCalledWith(
    expect.objectContaining({
      device: 'cpu',
      arguments: [
        '-HelperImage',
        expect.stringContaining('ModelLoom-peer-host.exe'),
        '-SharingAddress',
        '100.77.238.117',
      ],
    }),
    100000,
  );
  await expect(value.openNetwork('100.77.238.117', vi.fn())).rejects.toThrow('RPC_BUSY');
  await value.closeSharing();
  expect(close).toHaveBeenCalledOnce();
});

it('notifies unexpected network loss exactly once and excludes intentional shutdown', async () => {
  const value = backend();
  const stream = new Duplex({ read() {} });
  const close = vi.fn(() => {
    stream.emit('close');
    return Promise.resolve();
  });
  fixture.network.mockResolvedValueOnce({ stream, close });
  await value.openSharing([gpu]);
  const lost = vi.fn();
  await value.openNetwork('100.77.238.117', lost);
  stream.emit('error', Error('closed'));
  stream.emit('close');
  expect(lost).toHaveBeenCalledOnce();
  await value.closeSharing();
  expect(lost).toHaveBeenCalledOnce();
});

it('waits for pending network admission and closes it before releasing GPU seals', async () => {
  const value = backend();
  let ready!: (network: { stream: Duplex; close: () => Promise<void> }) => void;
  fixture.network.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        ready = resolve;
      }),
  );
  await value.openSharing([gpu]);
  const opening = value.openNetwork('100.77.238.117', vi.fn());
  await vi.waitFor(() => expect(fixture.network).toHaveBeenCalled());
  const closing = value.closeSharing();
  expect(fixture.release).not.toHaveBeenCalled();
  const close = vi.fn(() => Promise.resolve());
  ready({ stream: new Duplex({ read() {} }), close });
  await opening;
  await closing;
  expect(close).toHaveBeenCalledOnce();
  expect(fixture.release).toHaveBeenCalledOnce();
});

it('retains a failed network close and still attempts every GPU helper shutdown', async () => {
  const value = backend();
  const close = vi
    .fn()
    .mockRejectedValueOnce(Error('RPC_CLEANUP_FAILED'))
    .mockResolvedValue(undefined);
  fixture.network.mockResolvedValueOnce({ stream: new Duplex({ read() {} }), close });
  await value.openSharing([gpu, secondGpu]);
  await value.openNetwork('100.77.238.117', vi.fn());
  await expect(value.closeSharing()).rejects.toThrow('RPC_CLEANUP_FAILED');
  expect(fixture.stop).toHaveBeenCalledTimes(2);
  expect(fixture.release).not.toHaveBeenCalled();
  await value.closeSharing();
  expect(close).toHaveBeenCalledTimes(2);
  expect(fixture.stop).toHaveBeenCalledTimes(2);
  expect(fixture.release).toHaveBeenCalledOnce();
});

it('does not report intentional network close as lost and rejects public bind hosts', async () => {
  const value = backend();
  const stream = new Duplex({ read() {} });
  fixture.network.mockResolvedValueOnce({
    stream,
    close: () => {
      stream.emit('close');
      return Promise.resolve();
    },
  });
  await value.openSharing([gpu]);
  await expect(value.openNetwork('8.8.8.8', vi.fn())).rejects.toThrow('INVALID_CONTROL');
  expect(fixture.network).not.toHaveBeenCalled();
  const lost = vi.fn();
  await value.openNetwork('100.77.238.117', lost);
  await value.closeSharing();
  expect(lost).not.toHaveBeenCalled();
});

it.each(['SHARING_FIREWALL_FAILED', 'SHARING_PERMISSION_REQUIRED'])(
  'propagates network admission %s and retains uncertain launch seals',
  async (error) => {
    const value = backend();
    fixture.network.mockRejectedValueOnce(Error(error));
    await value.openSharing([gpu]);
    await expect(value.openNetwork('100.77.238.117', vi.fn())).rejects.toThrow(error);
    await expect(value.closeSharing()).rejects.toThrow('RPC_CLEANUP_FAILED');
    expect(fixture.stop).toHaveBeenCalledOnce();
    expect(fixture.release).not.toHaveBeenCalled();
  },
);

it('rejects an already destroyed network owner while retaining its cleanup handle', async () => {
  const value = backend();
  const stream = new Duplex({ read() {} });
  stream.destroy();
  const close = vi.fn(() => Promise.resolve());
  fixture.network.mockResolvedValueOnce({ stream, close });
  await value.openSharing([gpu]);
  await expect(value.openNetwork('100.77.238.117', vi.fn())).rejects.toThrow(
    'SHARING_FIREWALL_FAILED',
  );
  await value.closeSharing();
  expect(close).toHaveBeenCalledOnce();
  expect(fixture.release).toHaveBeenCalledOnce();
});

it('releases known GPU helpers and allows retry after confirmed pre-launch permission cancellation', async () => {
  const value = backend();
  fixture.network.mockRejectedValueOnce(new fixture.ConfirmedNetworkSetupFailure());
  await value.openSharing([gpu]);
  await expect(value.openNetwork('100.77.238.117', vi.fn())).rejects.toThrow(
    'SHARING_PERMISSION_REQUIRED',
  );
  await expect(value.closeSharing()).resolves.toBeUndefined();
  expect(fixture.release).toHaveBeenCalledOnce();
  await value.openSharing([gpu]);
  fixture.network.mockResolvedValueOnce({
    stream: new Duplex({ read() {} }),
    close: () => Promise.resolve(),
  });
  await value.openNetwork('100.77.238.117', vi.fn());
  await value.closeSharing();
  expect(fixture.release).toHaveBeenCalledTimes(2);
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

it('admits separate helpers for two GPUs and selects only the requested helper', async () => {
  const first = {
    start: vi.fn(() =>
      Promise.resolve({ stream: new Duplex({ read() {} }), close: () => Promise.resolve() }),
    ),
    close: vi.fn(() => Promise.resolve()),
  };
  const second = {
    start: vi.fn(() =>
      Promise.resolve({ stream: new Duplex({ read() {} }), close: () => Promise.resolve() }),
    ),
    close: vi.fn(() => Promise.resolve()),
  };
  fixture.open.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
  const value = backend();
  await value.openSharing([gpu, secondGpu]);
  await Promise.all([value.start([gpu]), value.start([secondGpu])]);
  expect(fixture.open.mock.calls.map((call) => call[1] as unknown)).toEqual([[gpu], [secondGpu]]);
  expect(first.start).toHaveBeenCalledOnce();
  expect(second.start).toHaveBeenCalledOnce();
  await expect(value.start([gpu, secondGpu])).rejects.toThrow('INVALID_GPU_RESERVATION');
  await expect(value.openSharing([gpu])).rejects.toThrow('RPC_BUSY');
  await value.closeSharing();
  expect(first.close).toHaveBeenCalledOnce();
  expect(second.close).toHaveBeenCalledOnce();
  expect(fixture.release).toHaveBeenCalledOnce();
});

it('rejects duplicate and over-limit sharing selections before launch', async () => {
  const value = backend();
  await expect(value.openSharing([gpu, gpu.toLowerCase()])).rejects.toThrow(
    'INVALID_GPU_RESERVATION',
  );
  await expect(value.openSharing(Array(17).fill(gpu))).rejects.toThrow('INVALID_GPU_RESERVATION');
  expect(fixture.open).not.toHaveBeenCalled();
});

it('cleans earlier helpers after partial startup while retaining uncertain launch seals', async () => {
  fixture.open
    .mockResolvedValueOnce({ start: fixture.start, close: fixture.stop })
    .mockRejectedValueOnce(Error('RPC_START_FAILED'));
  const value = backend();
  await expect(value.openSharing([gpu, secondGpu])).rejects.toThrow('RPC_START_FAILED');
  expect(fixture.stop).toHaveBeenCalledOnce();
  expect(fixture.release).not.toHaveBeenCalled();
  await expect(value.start([gpu])).rejects.toThrow('RPC_SHARING_REQUIRED');
  await expect(value.closeSharing()).rejects.toThrow('RPC_CLEANUP_FAILED');
  expect(fixture.stop).toHaveBeenCalledOnce();
  expect(fixture.release).not.toHaveBeenCalled();
});

it('closes every helper despite one failure and retries only pending shutdowns', async () => {
  const first = {
    start: fixture.start,
    close: vi.fn().mockRejectedValueOnce(Error('RPC_CLEANUP_FAILED')).mockResolvedValue(undefined),
  };
  const second = { start: fixture.start, close: vi.fn(() => Promise.resolve()) };
  fixture.open.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
  const value = backend();
  await value.openSharing([gpu, secondGpu]);
  await expect(value.closeSharing()).rejects.toThrow('RPC_CLEANUP_FAILED');
  expect(second.close).toHaveBeenCalledOnce();
  expect(fixture.release).not.toHaveBeenCalled();
  await value.closeSharing();
  expect(first.close).toHaveBeenCalledTimes(2);
  expect(second.close).toHaveBeenCalledOnce();
  expect(fixture.release).toHaveBeenCalledOnce();
});

it('retains retryable earlier handles when partial startup cleanup also fails', async () => {
  fixture.open
    .mockResolvedValueOnce({ start: fixture.start, close: fixture.stop })
    .mockRejectedValueOnce(Error('RPC_START_FAILED'));
  fixture.stop.mockRejectedValueOnce(Error('RPC_CLEANUP_FAILED'));
  const value = backend();
  await expect(value.openSharing([gpu, secondGpu])).rejects.toThrow('RPC_START_FAILED');
  expect(fixture.stop).toHaveBeenCalledOnce();
  await expect(value.closeSharing()).rejects.toThrow('RPC_CLEANUP_FAILED');
  expect(fixture.stop).toHaveBeenCalledTimes(2);
  await expect(value.openSharing([gpu])).rejects.toThrow('RPC_CLEANUP_FAILED');
  expect(fixture.stop).toHaveBeenCalledTimes(2);
  expect(fixture.open).toHaveBeenCalledTimes(2);
  expect(fixture.release).not.toHaveBeenCalled();
});

it('rejects a competing sharing request while helpers are being prepared', async () => {
  let release!: (value: { start: typeof fixture.start; close: typeof fixture.stop }) => void;
  fixture.open.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const value = backend();
  const opening = value.openSharing([gpu, secondGpu]);
  await vi.waitFor(() => expect(fixture.open).toHaveBeenCalledOnce());
  await expect(value.openSharing([secondGpu])).rejects.toThrow('RPC_BUSY');
  release({ start: fixture.start, close: fixture.stop });
  await opening;
  expect(fixture.open).toHaveBeenCalledTimes(2);
  await value.closeSharing();
});

it('shares one approval deadline between all selected GPU helper launches', async () => {
  vi.useFakeTimers({ toFake: ['performance'] });
  fixture.open.mockImplementationOnce(() => {
    vi.advanceTimersByTime(45000);
    return Promise.resolve({ start: fixture.start, close: fixture.stop });
  });
  const value = backend();
  await value.openSharing([gpu, secondGpu]);
  expect(fixture.open.mock.calls.map((call) => call[2] as unknown)).toEqual([120000, 75000]);
  await value.closeSharing();
});

it('does not launch another helper after the shared approval deadline expires', async () => {
  vi.useFakeTimers({ toFake: ['performance'] });
  fixture.open.mockImplementationOnce(() => {
    vi.advanceTimersByTime(120001);
    return Promise.resolve({ start: fixture.start, close: fixture.stop });
  });
  const value = backend();
  await expect(value.openSharing([gpu, secondGpu])).rejects.toThrow('RPC_START_TIMEOUT');
  expect(fixture.open).toHaveBeenCalledOnce();
  expect(fixture.stop).toHaveBeenCalledOnce();
  expect(fixture.release).toHaveBeenCalledOnce();
  await expect(value.closeSharing()).resolves.toBeUndefined();
  await value.openSharing([secondGpu]);
  expect(fixture.open).toHaveBeenCalledTimes(2);
  await value.closeSharing();
});
