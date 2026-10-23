import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { PassThrough } from 'node:stream';
import { createServer } from 'node:net';
import { PeerNode } from './node.js';
import { openWindowsPeerIdentity } from './windows-identity.js';
import type { WindowsPeerIdentity } from './windows-identity.js';

const gpu = 'GPU-11111111-1111-1111-1111-111111111111';
function deferred() {
  let resolve!: () => void, reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('Missing listener');
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}
async function canBind(port: number): Promise<boolean> {
  const server = createServer();
  return new Promise((resolve) => {
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}
describe('sharing network admission over real Windows TLS identity', () => {
  let identity: WindowsPeerIdentity, remoteIdentity: WindowsPeerIdentity;
  const nodes: PeerNode[] = [];
  beforeAll(async () => {
    [identity, remoteIdentity] = await Promise.all([
      openWindowsPeerIdentity(),
      openWindowsPeerIdentity(),
    ]);
  }, 30000);
  afterEach(async () => {
    await Promise.all(nodes.splice(0).map((node) => node.close()));
  });
  afterAll(() => {
    identity?.close();
    remoteIdentity?.close();
  });
  function fixture(network = deferred()) {
    const callbacks: (() => void)[] = [];
    const closeSharing = vi.fn(async () => {});
    const close = vi.fn(async () => {});
    const openSharing = vi.fn(async () => {});
    const openNetwork = vi.fn(async (_address: string, lost: () => void) => {
      callbacks.push(lost);
      await network.promise;
    });
    const backend = {
      openSharing,
      openNetwork,
      closeSharing,
      start: vi.fn(() => Promise.resolve({ stream: new PassThrough(), close })),
    };
    const worker = new PeerNode(
      identity,
      'PTSS',
      [{ id: gpu, name: 'GPU', memoryBytes: 4096 }],
      backend,
    );
    nodes.push(worker);
    return { worker, network, callbacks, closeSharing, close, openSharing, openNetwork };
  }
  it('listens without advertising until network approval succeeds and supplies only the selected host', async () => {
    const { worker, network, openNetwork, openSharing } = fixture();
    const bootstrap = await freePort(),
      secure = await freePort();
    const opening = worker.share('127.0.0.1', bootstrap, secure, [gpu]);
    void opening.catch(() => undefined);
    try {
      await vi.waitFor(() => expect(openNetwork).toHaveBeenCalledOnce());
      expect(openSharing).toHaveBeenCalledExactlyOnceWith([gpu]);
      expect(openNetwork.mock.calls[0]).toEqual(['127.0.0.1', expect.any(Function)]);
      expect(await canBind(bootstrap)).toBe(false);
      expect(await canBind(secure)).toBe(false);
      expect(worker.snapshot().sharing).toBe(false);
    } finally {
      network.resolve();
      await opening;
    }
    expect(worker.snapshot().sharing).toBe(true);
  });
  it.each(['SHARING_FIREWALL_FAILED', 'SHARING_FIREWALL_PERMISSION_DENIED'])(
    'closes both listeners and GPU sharing when network preparation fails: %s',
    async (code) => {
      const { worker, network, openNetwork, closeSharing } = fixture();
      const bootstrap = await freePort(),
        secure = await freePort();
      const opening = worker.share('127.0.0.1', bootstrap, secure, [gpu]);
      void opening.catch(() => undefined);
      try {
        await vi.waitFor(() => expect(openNetwork).toHaveBeenCalledOnce());
      } finally {
        network.reject(Error(code));
      }
      await expect(opening).rejects.toThrow(code);
      expect(worker.snapshot().sharing).toBe(false);
      expect(closeSharing).toHaveBeenCalledOnce();
      expect(await canBind(bootstrap)).toBe(true);
      expect(await canBind(secure)).toBe(true);
    },
  );
  it('network loss shuts down active workers and disables sharing', async () => {
    const { worker, network, callbacks, close, closeSharing } = fixture();
    network.resolve();
    const address = await worker.share('127.0.0.1', 0, 0, [gpu]);
    expect(callbacks).toHaveLength(1);
    const coordinator = new PeerNode(remoteIdentity, 'Coordinator', []);
    nodes.push(coordinator);
    const invite = await coordinator.invite(address);
    await coordinator.verifyCode(
      invite.id,
      worker.snapshot().incoming.find((p) => p.id === invite.id)!.pairingCode!,
    );
    await worker.approve(invite.id, remoteIdentity.fingerprint);
    const stream = await coordinator.openRpc(invite.id, gpu);
    callbacks[0]!();
    await vi.waitFor(() => {
      expect(worker.snapshot().sharing).toBe(false);
      expect(close).toHaveBeenCalledOnce();
      expect(closeSharing).toHaveBeenCalledOnce();
    });
    stream.destroy();
  });
  it('ignores a previous session network-loss callback after sharing restarts', async () => {
    const { worker, network, callbacks } = fixture();
    network.resolve();
    await worker.share('127.0.0.1', 0, 0, [gpu]);
    expect(callbacks).toHaveLength(1);
    await worker.stopSharing();
    await worker.share('127.0.0.1', 0, 0, [gpu]);
    expect(callbacks).toHaveLength(2);
    callbacks[0]!();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(worker.snapshot().sharing).toBe(true);
  });
  it('does not enable sharing when pending network approval finishes after Stop', async () => {
    const { worker, network, openNetwork } = fixture();
    const opening = worker.share('127.0.0.1', 0, 0, [gpu]);
    void opening.catch(() => undefined);
    try {
      await vi.waitFor(() => expect(openNetwork).toHaveBeenCalledOnce());
      await worker.stopSharing();
    } finally {
      network.resolve();
    }
    await expect(opening).rejects.toThrow();
    expect(worker.snapshot().sharing).toBe(false);
  });
});
