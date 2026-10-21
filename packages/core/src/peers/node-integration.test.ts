import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { openWindowsPeerIdentity } from './windows-identity.js';
import type { WindowsPeerIdentity } from './windows-identity.js';
import { PeerNode } from './node.js';
import { DiagnosticRpcBackend } from './diagnostic-rpc.js';
import { createServer } from 'node:http';
import { peerAddress } from './node.js';
import { PassThrough } from 'node:stream';

describe('real TLS peer pairing', () => {
  let sg: WindowsPeerIdentity, my: WindowsPeerIdentity;
  const nodes: PeerNode[] = [];
  beforeAll(async () => {
    sg = await openWindowsPeerIdentity();
    my = await openWindowsPeerIdentity();
  }, 20_000);
  afterAll(async () => {
    await Promise.all(nodes.map((node) => node.close()));
    sg?.close();
    my?.close();
  });

  it('prepares the helper before sharing and closes it when sharing stops', async () => {
    const gpu = 'GPU-11111111-1111-1111-1111-111111111111';
    const openSharing = vi.fn(async () => {}),
      closeSharing = vi.fn(async () => {});
    const worker = new PeerNode(my, 'MY', [{ id: gpu, name: 'Fixture', memoryBytes: 4096 }], {
      openSharing,
      closeSharing,
      start: () => Promise.reject(Error('Not requested')),
    });
    nodes.push(worker);
    await worker.share('127.0.0.1', 0, 0, [gpu]);
    expect(openSharing).toHaveBeenCalledExactlyOnceWith([gpu]);
    expect(worker.snapshot().sharing).toBe(true);
    await worker.stopSharing();
    expect(closeSharing).toHaveBeenCalledTimes(1);
    expect(worker.snapshot().sharing).toBe(false);
  });

  it('does not advertise availability when helper approval fails', async () => {
    const gpu = 'GPU-11111111-1111-1111-1111-111111111111';
    const worker = new PeerNode(my, 'MY', [{ id: gpu, name: 'Fixture', memoryBytes: 4096 }], {
      openSharing: () => Promise.reject(Error('Approval declined')),
      closeSharing: async () => {},
      start: () => Promise.reject(Error('Not requested')),
    });
    nodes.push(worker);
    await expect(worker.share('127.0.0.1', 0, 0, [gpu])).rejects.toThrow('PEER_UNAVAILABLE');
    expect(worker.snapshot().sharing).toBe(false);
  });

  it('accepts an explicit private port and cancels in-flight invitations on close', async () => {
    expect(peerAddress('100.69.84.91:49303').port).toBe('49303');
    const coordinator = new PeerNode(sg, 'SG', []);
    nodes.push(coordinator);
    let respond!: () => void, received!: () => void;
    const ready = new Promise<void>((resolve) => {
      received = resolve;
    });
    const server = createServer((request, response) => {
      request.resume();
      respond = () =>
        response.end(
          JSON.stringify({
            id: '11111111-1111-1111-1111-111111111111',
            name: 'MY',
            certificate: my.certificate.toString('base64'),
            authority: my.authority.toString('base64'),
            securePort: 49302,
          }),
        );
      received();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Missing test listener');
      const invitation = coordinator.invite(`http://127.0.0.1:${address.port}/`);
      void invitation.catch(() => undefined);
      await ready;
      await coordinator.close();
      respond();
      await expect(invitation).rejects.toThrow('PEER_UNAVAILABLE');
      expect(coordinator.snapshot().outgoing).toEqual([]);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('requires both fingerprint confirmations and approval before exposing selected GPUs', async () => {
    const coordinator = new PeerNode(sg, 'Singapore', []);
    const worker = new PeerNode(my, 'Malaysia', [
      { id: 'gpu-my', name: 'Test GPU', memoryBytes: 4096 },
    ]);
    nodes.push(coordinator, worker);
    const address = await worker.share('127.0.0.1', 0, 0, ['gpu-my']);
    const outgoing = await coordinator.invite(address);
    expect(worker.snapshot().incoming).toHaveLength(1);
    expect(worker.snapshot().incoming[0]?.peerFingerprint).toBe(sg.fingerprint);
    await expect(coordinator.inventory(outgoing.id)).rejects.toThrow('PEER_NOT_APPROVED');
    await expect(worker.approve(outgoing.id, '0'.repeat(64))).rejects.toThrow(
      'FINGERPRINT_MISMATCH',
    );
    await worker.approve(outgoing.id, sg.fingerprint);
    await expect(coordinator.inventory(outgoing.id)).rejects.toThrow('PEER_NOT_APPROVED');
    await coordinator.confirm(outgoing.id, my.fingerprint);
    expect((await coordinator.status(outgoing.id)).phase).toBe('approved');
    expect(await coordinator.inventory(outgoing.id)).toEqual([
      { id: 'gpu-my', name: 'Test GPU', memoryBytes: 4096 },
    ]);
    await worker.stopSharing();
    await expect(coordinator.inventory(outgoing.id)).rejects.toThrow();
  }, 20_000);

  it('does not accept a request when sharing is off or an identity pin differs', async () => {
    const coordinator = new PeerNode(sg, 'SG', []);
    const worker = new PeerNode(my, 'MY', [{ id: 'only-gpu', name: 'GPU', memoryBytes: 4096 }]);
    nodes.push(coordinator, worker);
    const address = await worker.share('127.0.0.1', 0, 0, ['only-gpu']);
    const outgoing = await coordinator.invite(address);
    await expect(coordinator.confirm(outgoing.id, sg.fingerprint)).rejects.toThrow(
      'FINGERPRINT_MISMATCH',
    );
    worker.decline(outgoing.id);
    await expect(coordinator.confirm(outgoing.id, my.fingerprint)).rejects.toThrow('PEER_DECLINED');
    await worker.stopSharing();
    expect(worker.snapshot().sharing).toBe(false);
  }, 20_000);

  it('requires pairing before carrying a real stock RPC handshake through mTLS', async () => {
    const gpu = 'GPU-11111111-1111-1111-1111-111111111111';
    const coordinator = new PeerNode(sg, 'SG', []);
    const worker = new PeerNode(
      my,
      'MY',
      [{ id: gpu, name: 'CPU protocol fixture', memoryBytes: 4096 }],
      new DiagnosticRpcBackend('cpu'),
    );
    nodes.push(coordinator, worker);
    const address = await worker.share('127.0.0.1', 0, 0, [gpu]);
    const outgoing = await coordinator.invite(address);
    await expect(coordinator.openRpc(outgoing.id)).rejects.toThrow('PEER_NOT_APPROVED');
    await coordinator.confirm(outgoing.id, my.fingerprint);
    await worker.approve(outgoing.id, sg.fingerprint);
    const stream = await coordinator.openRpc(outgoing.id);
    const response = new Promise<Buffer>((resolve, reject) => {
      let bytes = Buffer.alloc(0);
      stream.on('data', (value: Buffer) => {
        bytes = Buffer.concat([bytes, value]);
        if (bytes.length >= 36) resolve(bytes);
      });
      stream.once('error', reject);
    });
    const hello = Buffer.alloc(33);
    hello[0] = 14;
    hello.writeBigUInt64LE(24n, 1);
    stream.write(hello);
    expect([...(await response).subarray(8, 11)]).toEqual([7, 0, 0]);
    stream.destroy();
    await worker.stopSharing();
  }, 30_000);

  it('allows an approved worker to finish within its full startup budget', async () => {
    const gpu = 'GPU-11111111-1111-1111-1111-111111111111';
    const coordinator = new PeerNode(sg, 'SG', []);
    const worker = new PeerNode(
      my,
      'MY',
      [{ id: gpu, name: 'Delayed permission fixture', memoryBytes: 4096 }],
      {
        start: async () => {
          // Native verification and a human approval can exceed 15 seconds
          // while remaining inside the worker's existing 20-second deadline.
          await new Promise((resolve) => setTimeout(resolve, 16_000));
          const stream = new PassThrough();
          return {
            stream,
            close: () => {
              stream.destroy();
              return Promise.resolve();
            },
          };
        },
      },
    );
    nodes.push(coordinator, worker);
    const address = await worker.share('127.0.0.1', 0, 0, [gpu]);
    const outgoing = await coordinator.invite(address);
    await coordinator.confirm(outgoing.id, my.fingerprint);
    await worker.approve(outgoing.id, sg.fingerprint);
    try {
      const stream = await coordinator.openRpc(outgoing.id);
      const received = new Promise<Buffer>((resolve, reject) => {
        stream.once('data', resolve);
        stream.once('error', reject);
      });
      stream.write('approved bytes');
      expect((await received).toString()).toBe('approved bytes');
      stream.destroy();
    } finally {
      await coordinator.close();
      await worker.close();
    }
  }, 30_000);

  it('recovers sharing after confirmed full helper cleanup settles a failed worker receipt', async () => {
    const gpu = 'GPU-11111111-1111-1111-1111-111111111111';
    const coordinator = new PeerNode(sg, 'SG', []);
    const closeSharing = vi.fn(async () => {});
    const worker = new PeerNode(
      my,
      'MY',
      [{ id: gpu, name: 'Recovery fixture', memoryBytes: 4096 }],
      {
        closeSharing,
        start: () =>
          Promise.resolve({
            stream: new PassThrough(),
            close: () => Promise.reject(Error('RPC_CLEANUP_FAILED')),
          }),
      },
    );
    nodes.push(coordinator, worker);
    const address = await worker.share('127.0.0.1', 0, 0, [gpu]);
    const outgoing = await coordinator.invite(address);
    await coordinator.confirm(outgoing.id, my.fingerprint);
    await worker.approve(outgoing.id, sg.fingerprint);
    const stream = await coordinator.openRpc(outgoing.id);
    try {
      await expect(worker.stopSharing()).resolves.toBeUndefined();
      const local = worker.reserveLocal([gpu]);
      worker.releaseLocal(local);
      const restarted = await worker.share('127.0.0.1', 0, 0, [gpu]);
      expect(worker.snapshot().incoming).toEqual([]);
      const next = await coordinator.invite(restarted);
      await coordinator.confirm(next.id, my.fingerprint);
      await worker.approve(next.id, sg.fingerprint);
      const replacement = await coordinator.openRpc(next.id);
      replacement.destroy();
    } finally {
      stream.destroy();
    }
  });

  it('retries cleanup before an explicit sharing restart after a helper timeout', async () => {
    const gpu = 'GPU-11111111-1111-1111-1111-111111111111';
    const coordinator = new PeerNode(sg, 'SG', []);
    const closeSharing = vi
      .fn()
      .mockRejectedValueOnce(Error('RPC_CLEANUP_FAILED'))
      .mockResolvedValue(undefined);
    const worker = new PeerNode(
      my,
      'MY',
      [{ id: gpu, name: 'Late cleanup fixture', memoryBytes: 4096 }],
      {
        closeSharing,
        start: () =>
          Promise.resolve({
            stream: new PassThrough(),
            close: () => Promise.reject(Error('RPC_CLEANUP_FAILED')),
          }),
      },
    );
    nodes.push(coordinator, worker);
    const address = await worker.share('127.0.0.1', 0, 0, [gpu]);
    const outgoing = await coordinator.invite(address);
    await coordinator.confirm(outgoing.id, my.fingerprint);
    await worker.approve(outgoing.id, sg.fingerprint);
    const stream = await coordinator.openRpc(outgoing.id);
    try {
      await expect(worker.stopSharing()).rejects.toThrow('RPC_CLEANUP_FAILED');
      await worker.share('127.0.0.1', 0, 0, [gpu]);
      expect(closeSharing).toHaveBeenCalledTimes(2);
      const local = worker.reserveLocal([gpu]);
      worker.releaseLocal(local);
    } finally {
      stream.destroy();
    }
  });

  it('keeps the GPU quarantined when full helper cleanup fails', async () => {
    const gpu = 'GPU-11111111-1111-1111-1111-111111111111';
    const coordinator = new PeerNode(sg, 'SG', []);
    const worker = new PeerNode(
      my,
      'MY',
      [{ id: gpu, name: 'Failed helper fixture', memoryBytes: 4096 }],
      {
        closeSharing: () => Promise.reject(Error('RPC_CLEANUP_FAILED')),
        start: () =>
          Promise.resolve({
            stream: new PassThrough(),
            close: () => Promise.reject(Error('RPC_CLEANUP_FAILED')),
          }),
      },
    );
    const address = await worker.share('127.0.0.1', 0, 0, [gpu]);
    const outgoing = await coordinator.invite(address);
    await coordinator.confirm(outgoing.id, my.fingerprint);
    await worker.approve(outgoing.id, sg.fingerprint);
    const stream = await coordinator.openRpc(outgoing.id);
    try {
      await expect(worker.stopSharing()).rejects.toThrow('RPC_CLEANUP_FAILED');
      expect(() => worker.reserveLocal([gpu])).toThrow('NOT_READY');
      await expect(coordinator.openRpc(outgoing.id)).rejects.toThrow();
    } finally {
      stream.destroy();
      await worker.close().catch(() => undefined);
      await coordinator.close();
    }
  });

  it('bounds failed native teardown and quarantines its GPU instead of admitting new work', async () => {
    const gpu = 'GPU-11111111-1111-1111-1111-111111111111';
    const coordinator = new PeerNode(sg, 'SG', []);
    const worker = new PeerNode(
      my,
      'MY',
      [{ id: gpu, name: 'Synthetic lifecycle GPU', memoryBytes: 4096 }],
      {
        start: () =>
          Promise.resolve({ stream: new PassThrough(), close: () => new Promise(() => {}) }),
      },
      { startup: 1000, stop: 30 },
    );
    const address = await worker.share('127.0.0.1', 0, 0, [gpu]);
    const outgoing = await coordinator.invite(address);
    await coordinator.confirm(outgoing.id, my.fingerprint);
    await worker.approve(outgoing.id, sg.fingerprint);
    const stream = await coordinator.openRpc(outgoing.id);
    try {
      await expect(worker.stopSharing()).rejects.toThrow('RPC_CLEANUP_FAILED');
      expect(worker.snapshot().sharing).toBe(false);
      await expect(coordinator.openRpc(outgoing.id)).rejects.toThrow();
    } finally {
      stream.destroy();
      await coordinator.close();
      await worker.close().catch(() => undefined); // Failure is asserted above, never reported as clean.
    }
  });
});
