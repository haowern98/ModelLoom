import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: fixture.spawn }));
vi.mock('../hosts/windows-ownership.js', () => ({
  ownershipBinding: () => ({ systemDirectory: () => 'C:/Windows/System32' }),
}));
import {
  launchOwnedRpcRelay,
  launchOwnedRpcSession,
  launchOwnedSharingNetwork,
} from './rpc-relay.js';
let child: EventEmitter & {
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  kill: ReturnType<typeof vi.fn>;
};
beforeEach(() => {
  child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
  });
  fixture.spawn.mockImplementation(() => {
    queueMicrotask(() =>
      child.stdout.write(JSON.stringify({ phase: 'relay-ready', workerRestricted: true }) + '\n'),
    );
    return child;
  });
});
afterEach(() => vi.useRealTimers());
const networkOptions = { device: 'cuda' as const, script: 'E:/trusted-network.ps1', arguments: [] };
it.each([0, -1, 120001, 1.5, NaN, Infinity])(
  'rejects network approval budget %s before spawning',
  async (budget) => {
    fixture.spawn.mockClear();
    await expect(launchOwnedSharingNetwork(networkOptions, budget)).rejects.toThrow(
      'INVALID_RPC_DEADLINE',
    );
    expect(fixture.spawn).not.toHaveBeenCalled();
  },
);
it('accepts network readiness without a GPU probe and waits for owned exit on close', async () => {
  fixture.spawn.mockImplementation(() => {
    queueMicrotask(() => child.stdout.write(JSON.stringify({ phase: 'network-ready' }) + '\n'));
    return child;
  });
  const network = await launchOwnedSharingNetwork(networkOptions, 120000);
  const spawnOptions = fixture.spawn.mock.calls[0]![2] as { env: Record<string, string> };
  expect(spawnOptions.env).not.toHaveProperty('MODELLOOM_PROBE_GPU_UUID');
  let closed = false;
  const closing = network.close().then(() => {
    closed = true;
  });
  await Promise.resolve();
  expect(closed).toBe(false);
  child.emit('exit', 0);
  await closing;
  expect(closed).toBe(true);
  expect(child.kill).not.toHaveBeenCalled();
});
it.each(['relay-ready', 'helper-ready'])(
  'rejects %s as network preflight readiness',
  async (phase) => {
    fixture.spawn.mockImplementation(() => {
      queueMicrotask(() =>
        child.stdout.write(JSON.stringify({ phase, workerRestricted: true }) + '\n'),
      );
      return child;
    });
    child.stdin.once('close', () => child.emit('exit', 0));
    await expect(launchOwnedSharingNetwork(networkOptions, 1)).rejects.toThrow(
      'INVALID_RPC_REPORT',
    );
  },
);
it('rejects nonzero network exit during owned cleanup', async () => {
  fixture.spawn.mockImplementation(() => {
    queueMicrotask(() => child.stdout.write(JSON.stringify({ phase: 'network-ready' }) + '\n'));
    return child;
  });
  const network = await launchOwnedSharingNetwork(networkOptions, 120000);
  const closing = expect(network.close()).rejects.toThrow('RPC_CLEANUP_FAILED');
  child.emit('exit', 1);
  await closing;
});
it.each([
  {
    marker: 'SHARING_FIREWALL_PERMISSION_DENIED',
    code: 1223,
    expected: 'SHARING_FIREWALL_PERMISSION_DENIED',
  },
  { marker: 'SHARING_FIREWALL_FAILED', code: 1, expected: 'SHARING_FIREWALL_FAILED' },
])('reports local network setup failure $expected', async ({ marker, code, expected }) => {
  fixture.spawn.mockImplementation(() => {
    queueMicrotask(() => {
      child.stderr.write(marker + '\n');
      child.emit('exit', code);
    });
    return child;
  });
  await expect(launchOwnedSharingNetwork(networkOptions, 120000)).rejects.toThrow(expected);
});
it('uses the remaining approval budget and settles owned teardown before rejecting', async () => {
  vi.useFakeTimers();
  fixture.spawn.mockReset();
  fixture.spawn.mockReturnValue(child);
  child.stdin.once('close', () => child.emit('exit', 0));
  const rejected = expect(
    launchOwnedRpcSession(
      { device: 'cuda', script: 'E:/trusted.ps1', arguments: [] },
      ['GPU-11111111-1111-1111-1111-111111111111'],
      25,
    ),
  ).rejects.toThrow('RPC_START_TIMEOUT');
  await vi.advanceTimersByTimeAsync(24);
  expect(child.stdin.destroyed).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  await rejected;
  expect(child.stdin.destroyed).toBe(true);
  expect(child.kill).not.toHaveBeenCalled();
});
it.each([0, -1, 120001, 1.5, NaN, Infinity])(
  'rejects invalid trusted approval budget %s before spawning',
  async (budget) => {
    fixture.spawn.mockClear();
    await expect(
      launchOwnedRpcSession(
        { device: 'cuda', script: 'E:/trusted.ps1', arguments: [] },
        ['GPU-11111111-1111-1111-1111-111111111111'],
        budget,
      ),
    ).rejects.toThrow('INVALID_RPC_DEADLINE');
    expect(fixture.spawn).not.toHaveBeenCalled();
  },
);
it.each([0, 1])(
  'rechecks late owned relay exit after a cleanup timeout, exit code %i',
  async (code) => {
    const relay = await launchOwnedRpcRelay(
      { device: 'cpu', script: 'E:/trusted-script.ps1', arguments: [] },
      [],
    );
    vi.useFakeTimers();
    const timedOut = expect(relay.close()).rejects.toThrow('RPC_CLEANUP_FAILED');
    await vi.advanceTimersByTimeAsync(12000);
    await timedOut;
    const retried = relay.close();
    child.emit('exit', code);
    if (code === 0) await expect(retried).resolves.toBeUndefined();
    else await expect(retried).rejects.toThrow('RPC_CLEANUP_FAILED');
    expect(fixture.spawn).toHaveBeenCalledTimes(1);
  },
);
