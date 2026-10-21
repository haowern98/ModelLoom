import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: fixture.spawn }));
vi.mock('../hosts/windows-ownership.js', () => ({
  ownershipBinding: () => ({ systemDirectory: () => 'C:/Windows/System32' }),
}));
import { launchOwnedRpcRelay } from './rpc-relay.js';
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
