import { expect, it, vi } from 'vitest';
import { cleanupForQuit } from './quit-cleanup';

it('waits for runtime teardown before releasing its network transport', async () => {
  let finish!: () => void;
  const runtime = { quit: () => new Promise<void>((resolve) => (finish = resolve)) };
  const network = { close: vi.fn(async () => {}) };
  const closing = cleanupForQuit(runtime, network);
  expect(network.close).not.toHaveBeenCalled();
  finish();
  await closing;
  expect(network.close).toHaveBeenCalledTimes(1);
});

it('still closes the network when runtime cleanup rejects and retains the original cause', async () => {
  const cause = Error('PEER_CLEANUP_FAILED');
  const network = { close: vi.fn(async () => {}) };
  const result = cleanupForQuit(
    {
      quit: () => Promise.reject(cause),
    },
    network,
  );
  await expect(result).rejects.toMatchObject({ message: 'RUNTIME_CLEANUP_FAILED', cause });
  expect(network.close).toHaveBeenCalledTimes(1);
});

it('distinguishes network cleanup failure from runtime cleanup failure', async () => {
  const cause = Error('NETWORK_TIMEOUT');
  await expect(
    cleanupForQuit(undefined, {
      close: () => Promise.reject(cause),
    }),
  ).rejects.toMatchObject({ message: 'NETWORK_CLEANUP_FAILED', cause });
});

it('retains both failures when neither owner can confirm cleanup', async () => {
  const runtime = Error('PEER_CLEANUP_FAILED');
  const network = Error('NETWORK_TIMEOUT');
  const result = cleanupForQuit(
    {
      quit: () => Promise.reject(runtime),
    },
    {
      close: () => Promise.reject(network),
    },
  );
  await expect(result).rejects.toMatchObject({
    message: 'RUNTIME_AND_NETWORK_CLEANUP_FAILED',
    errors: [
      { message: 'RUNTIME_CLEANUP_FAILED', cause: runtime },
      { message: 'NETWORK_CLEANUP_FAILED', cause: network },
    ],
  });
});

it('allows another cleanup attempt after a previous failure', async () => {
  const runtime = {
    quit: vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(Error('CLEANUP_FAILED'))
      .mockResolvedValue(undefined),
  };
  const network = { close: vi.fn(async () => {}) };
  await expect(cleanupForQuit(runtime, network)).rejects.toThrow();
  await expect(cleanupForQuit(runtime, network)).resolves.toBeUndefined();
  expect(network.close).toHaveBeenCalledTimes(2);
});
