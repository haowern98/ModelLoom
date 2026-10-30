import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { openWindowsPeerIdentity } from './windows-identity.js';
import type { WindowsPeerIdentity } from './windows-identity.js';
import { PeerNode } from './node.js';
import { DiagnosticRpcBackend } from './diagnostic-rpc.js';
import { createServer } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { peerAddress } from './node.js';
import { PassThrough } from 'node:stream';
import { once } from 'node:events';
import { isTransientPeerFailure } from './deadline.js';
import { overlayChannel } from './overlay-channel.js';
import type { PeerFailure } from './failure-journal.js';

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

  it('allows an authenticated inventory long-poll to finish after five seconds', async () => {
    const worker = new PeerNode(my, 'MY', [{ id: 'gpu', name: 'GPU', memoryBytes: 4096 }]);
    const coordinator = new PeerNode(sg, 'SG', []);
    nodes.push(worker, coordinator);
    const address = await worker.share('127.0.0.1', 0, 0, ['gpu']);
    const outgoing = await coordinator.invite(address);
    await coordinator.verifyCode(
      outgoing.id,
      worker.snapshot().incoming.find((p) => p.id === outgoing.id)!.pairingCode!,
    );
    await worker.approve(outgoing.id, sg.fingerprint);
    const control = worker as unknown as {
      control(request: IncomingMessage): Promise<unknown>;
    };
    const original = control.control.bind(worker);
    const spy = vi.spyOn(control, 'control').mockImplementation(async (request) => {
      if (request.url === '/v1/inventory-watch')
        await new Promise((resolve) => setTimeout(resolve, 6000));
      return original(request);
    });
    try {
      await expect(coordinator.watchInventory(outgoing.id, -1)).resolves.toMatchObject({
        gpus: [{ id: 'gpu' }],
      });
    } finally {
      spy.mockRestore();
    }
  }, 20000);

  it.each(['recover', 'offline', 'revoked'] as const)(
    'keeps RPC heartbeat handling bounded for %s',
    async (outcome) => {
      const gpu = 'GPU-11111111-1111-1111-1111-111111111111';
      const coordinator = new PeerNode(sg, 'SG', []);
      const worker = new PeerNode(my, 'MY', [{ id: gpu, name: 'GPU', memoryBytes: 4096 }], {
        start: () => {
          const stream = new PassThrough();
          return Promise.resolve({
            stream,
            close: () => {
              stream.destroy();
              return Promise.resolve();
            },
          });
        },
      });
      nodes.push(coordinator, worker);
      const address = await worker.share('127.0.0.1', 0, 0, [gpu]);
      const outgoing = await coordinator.invite(address);
      await coordinator.verifyCode(
        outgoing.id,
        worker.snapshot().incoming.find((p) => p.id === outgoing.id)!.pairingCode!,
      );
      await worker.approve(outgoing.id, sg.fingerprint);
      const calls = coordinator as unknown as {
        call(id: string, operation: string, data?: object): Promise<unknown>;
      };
      const original = calls.call.bind(coordinator);
      let heartbeats = 0;
      const spy = vi.spyOn(calls, 'call').mockImplementation((id, operation, data) => {
        if (operation === 'heartbeat') {
          ++heartbeats;
          if (outcome === 'revoked') return Promise.reject(Error('PEER_NOT_APPROVED'));
          if (heartbeats === 1 || outcome === 'offline')
            return Promise.reject(
              new Error('PEER_UNAVAILABLE', {
                cause: Object.assign(Error('Request deadline exceeded'), { code: 'ETIMEDOUT' }),
              }),
            );
        }
        return original(id, operation, data);
      });
      const stream = await coordinator.openRpc(outgoing.id);
      stream.on('error', () => undefined);
      try {
        await vi.waitFor(() => expect(heartbeats).toBeGreaterThan(0), { timeout: 4500 });
        expect(stream.destroyed).toBe(outcome === 'revoked');
        if (outcome !== 'revoked') {
          await vi.waitFor(() => expect(heartbeats).toBeGreaterThan(1), { timeout: 4500 });
          expect(stream.destroyed).toBe(outcome === 'offline');
        }
      } finally {
        spy.mockRestore();
        stream.destroy();
      }
    },
    20000,
  );

  it('renews an active RPC lease after a stalled overlay heartbeat dial', async () => {
    const gpu = 'GPU-11111111-1111-1111-1111-111111111111';
    const failures: PeerFailure[] = [];
    const coordinator = new PeerNode(sg, 'SG', [], undefined, undefined, undefined, (event) =>
      failures.push(event),
    );
    const worker = new PeerNode(my, 'MY', [{ id: gpu, name: 'Fixture', memoryBytes: 4096 }], {
      start: () => {
        const stream = new PassThrough();
        return Promise.resolve({
          stream,
          close: () => {
            stream.destroy();
            return Promise.resolve();
          },
        });
      },
    });
    nodes.push(coordinator, worker);
    const address = await worker.share('127.0.0.1', 0, 0, [gpu]);
    const outgoing = await coordinator.invite(address);
    await coordinator.verifyCode(
      outgoing.id,
      worker.snapshot().incoming.find((p) => p.id === outgoing.id)!.pairingCode!,
    );
    await worker.approve(outgoing.id, sg.fingerprint);
    const stream = await coordinator.openRpc(outgoing.id, gpu);
    stream.on('error', () => undefined);
    let received = 0;
    stream.on('data', (bytes: Buffer) => {
      received += bytes.length;
    });
    // Withhold one dial acknowledgement; the real overlay timer allows ten seconds.
    const stalled = overlayChannel(() => {});
    stalled.receive({ type: 'overlay-routes', addresses: ['100.64.0.2'] });
    let first = true,
      cancelled = false;
    coordinator.setOverlay({
      has: () => first,
      dial: (_address, _port, signal) => {
        first = false;
        signal?.addEventListener('abort', () => (cancelled = true), { once: true });
        return stalled.transport.dial('100.64.0.2', 49302, signal);
      },
    });
    const traffic = setInterval(() => {
      if (!stream.destroyed) stream.write(Buffer.alloc(32768, 19));
    }, 100);
    try {
      await new Promise((resolve) => setTimeout(resolve, 17500));
      expect(stream.destroyed).toBe(false);
      expect(received).toBeGreaterThan(1024 * 1024);
      expect(cancelled).toBe(true);
      const heartbeatFailures = failures.filter((event) => event.stage === 'heartbeat');
      expect(heartbeatFailures).toHaveLength(1);
      expect(heartbeatFailures[0]).toMatchObject({
        decision: 'retry',
        error: { message: 'PEER_UNAVAILABLE', cause: { code: 'ETIMEDOUT' } },
      });
    } finally {
      clearInterval(traffic);
      stalled.close();
      stream.destroy();
    }
  }, 25000);

  it.each([
    'OVERLAY_DISCONNECTED',
    'OVERLAY_UNAVAILABLE',
    'NETWORK_TIMEOUT',
    'INVALID_PEER_CERTIFICATE',
    'FINGERPRINT_MISMATCH',
    'INVALID_CONTROL',
  ])(
    'confirms a local %s dial failure without granting grace to remote responses',
    async (message) => {
      const worker = new PeerNode(my, 'MY', [{ id: 'gpu', name: 'GPU', memoryBytes: 4096 }]);
      const coordinator = new PeerNode(sg, 'SG', []);
      nodes.push(worker, coordinator);
      const address = await worker.share('127.0.0.1', 0, 0, ['gpu']);
      const outgoing = await coordinator.invite(address);
      await coordinator.verifyCode(
        outgoing.id,
        worker.snapshot().incoming.find((p) => p.id === outgoing.id)!.pairingCode!,
      );
      await worker.approve(outgoing.id, sg.fingerprint);
      coordinator.setOverlay({
        has: () => true,
        dial: () => Promise.reject(Error(message)),
      });
      const failure = await coordinator.status(outgoing.id).catch((error: unknown) => error);
      expect(isTransientPeerFailure(failure)).toBe(
        ['OVERLAY_DISCONNECTED', 'OVERLAY_UNAVAILABLE', 'NETWORK_TIMEOUT'].includes(message),
      );
      expect(isTransientPeerFailure(Error(message))).toBe(false);
    },
  );

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
    const address = await worker.share('127.0.0.1', 0, 0, [gpu]);
    const response = await fetch(new URL('/v1/discover', address));
    const payload = await response.text();
    expect(response.headers.get('content-length')).toBe(String(Buffer.byteLength(payload)));
    expect(JSON.parse(payload)).toMatchObject({ sharing: true });
    expect(openSharing).toHaveBeenCalledExactlyOnceWith([gpu]);
    expect(worker.snapshot().sharing).toBe(true);
    await worker.stopSharing();
    expect(closeSharing).toHaveBeenCalledTimes(1);
    expect(worker.snapshot().sharing).toBe(false);
  });

  it('does not advertise availability when helper approval fails', async () => {
    const gpu = 'GPU-11111111-1111-1111-1111-111111111111';
    const closeSharing = vi.fn(async () => {});
    const worker = new PeerNode(my, 'MY', [{ id: gpu, name: 'Fixture', memoryBytes: 4096 }], {
      openSharing: () => Promise.reject(Error('Approval declined')),
      closeSharing,
      start: () => Promise.reject(Error('Not requested')),
    });
    nodes.push(worker);
    await expect(worker.share('127.0.0.1', 0, 0, [gpu])).rejects.toThrow('RPC_SHARING_FAILED');
    expect(worker.snapshot().sharing).toBe(false);
    expect(closeSharing).toHaveBeenCalledOnce();
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
            pairing: 'code-v1',
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

  it('requires code verification and approval before exposing selected GPUs', async () => {
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
    await expect(worker.approve(outgoing.id, sg.fingerprint)).rejects.toThrow(
      'PAIRING_NOT_VERIFIED',
    );
    await coordinator.verifyCode(
      outgoing.id,
      worker.snapshot().incoming.find((p) => p.id === outgoing.id)!.pairingCode!,
    );
    await expect(coordinator.inventory(outgoing.id)).rejects.toThrow('PEER_NOT_APPROVED');
    await worker.approve(outgoing.id, sg.fingerprint);
    expect((await coordinator.status(outgoing.id)).phase).toBe('approved');
    expect(await coordinator.inventory(outgoing.id)).toEqual([
      { id: 'gpu-my', name: 'Test GPU', memoryBytes: 4096 },
    ]);
    await worker.stopSharing();
    await expect(coordinator.inventory(outgoing.id)).rejects.toThrow();
  }, 20_000);

  it('pushes approved shared hardware changes and closes a pending watch on disconnect', async () => {
    const coordinator = new PeerNode(sg, 'Coordinator', []);
    const worker = new PeerNode(my, 'PTSS', [{ id: 'gpu-my', name: 'GPU', memoryBytes: 4096 }]);
    nodes.push(coordinator, worker);
    const address = await worker.share('127.0.0.1', 0, 0, ['gpu-my']);
    const outgoing = await coordinator.invite(address);
    await expect(coordinator.watchInventory(outgoing.id, -1)).rejects.toThrow('PEER_NOT_APPROVED');
    await coordinator.verifyCode(
      outgoing.id,
      worker.snapshot().incoming.find((p) => p.id === outgoing.id)!.pairingCode!,
    );
    await worker.approve(outgoing.id, sg.fingerprint);
    await worker.updateHardware({
      os: 'Windows',
      cpuName: 'PTSS CPU',
      threads: 20,
      sampledAt: 1,
      gpus: [
        { id: 'gpu-my', name: 'GPU', memoryBytes: 4096, availableMemoryBytes: 3000 },
        { id: 'private-gpu', name: 'Unshared GPU', memoryBytes: 8192 },
      ],
    });
    const first = await coordinator.watchInventory(outgoing.id, -1);
    expect(first.hardware?.cpuName).toBe('PTSS CPU');
    expect(first.hardware?.gpus.map((g) => g.id)).toEqual(['gpu-my']);
    const watch = coordinator.watchInventory(outgoing.id, first.revision);
    await worker.updateHardware({ os: 'Windows', cpuName: 'PTSS CPU', sampledAt: 2, gpus: [] });
    const removed = await watch;
    expect(removed.revision).toBeGreaterThan(first.revision);
    expect(removed.gpus).toEqual([]);
    const waiting = coordinator.watchInventory(outgoing.id, removed.revision);
    void waiting.catch(() => undefined);
    await worker.stopSharing();
    await expect(waiting).rejects.toThrow();
  }, 20_000);

  it('reserves only still-present shared GPUs and interrupts a worker when that GPU disappears', async () => {
    const a = 'GPU-11111111-1111-1111-1111-111111111111',
      b = 'GPU-22222222-2222-2222-2222-222222222222';
    const close = vi.fn(() => Promise.resolve());
    const start = vi.fn(() => Promise.resolve({ stream: new PassThrough(), close }));
    const coordinator = new PeerNode(sg, 'Coordinator', []);
    const worker = new PeerNode(
      my,
      'PTSS',
      [
        { id: a, name: 'A', memoryBytes: 4096 },
        { id: b, name: 'B', memoryBytes: 4096 },
      ],
      { start },
    );
    nodes.push(coordinator, worker);
    const address = await worker.share('127.0.0.1', 0, 0, [a, b]);
    const invited = await coordinator.invite(address);
    await coordinator.verifyCode(
      invited.id,
      worker.snapshot().incoming.find((p) => p.id === invited.id)!.pairingCode!,
    );
    await worker.approve(invited.id, sg.fingerprint);
    await worker.updateHardware({
      os: 'Windows',
      sampledAt: 1,
      gpus: [{ id: b, name: 'B', memoryBytes: 4096 }],
    });
    const stream = await coordinator.openRpc(invited.id);
    expect(start).toHaveBeenCalledWith([b]);
    await worker.updateHardware({
      os: 'Windows',
      sampledAt: 2,
      gpus: [{ id: b, name: 'B', memoryBytes: 4096, availableMemoryBytes: 100 }],
    });
    expect(close).not.toHaveBeenCalled();
    await worker.updateHardware({ os: 'Windows', sampledAt: 3, gpus: [] });
    expect(close).toHaveBeenCalledOnce();
    stream.destroy();
  }, 20000);

  it('cleans up a prepared worker if its GPU is removed before startup finishes', async () => {
    const gpu = 'GPU-11111111-1111-1111-1111-111111111111';
    let complete!: (owned: { stream: PassThrough; close: () => Promise<void> }) => void;
    let started!: () => void;
    const starting = new Promise<void>((resolve) => {
      started = resolve;
    });
    const close = vi.fn(() => Promise.resolve());
    const coordinator = new PeerNode(sg, 'Coordinator', []);
    const worker = new PeerNode(my, 'PTSS', [{ id: gpu, name: 'GPU', memoryBytes: 4096 }], {
      start: () => {
        started();
        return new Promise((resolve) => {
          complete = resolve;
        });
      },
    });
    nodes.push(coordinator, worker);
    const address = await worker.share('127.0.0.1', 0, 0, [gpu]);
    const invited = await coordinator.invite(address);
    await coordinator.verifyCode(
      invited.id,
      worker.snapshot().incoming.find((p) => p.id === invited.id)!.pairingCode!,
    );
    await worker.approve(invited.id, sg.fingerprint);
    const opening = coordinator.openRpc(invited.id);
    void opening.catch(() => undefined);
    await starting;
    await worker.updateHardware({ os: 'Windows', sampledAt: 1, gpus: [] });
    complete({ stream: new PassThrough(), close });
    await expect(opening).rejects.toThrow();
    expect(close).toHaveBeenCalledOnce();
  }, 20000);

  it('does not accept a request when sharing is off or an identity pin differs', async () => {
    const coordinator = new PeerNode(sg, 'SG', []);
    const worker = new PeerNode(my, 'MY', [{ id: 'only-gpu', name: 'GPU', memoryBytes: 4096 }]);
    nodes.push(coordinator, worker);
    const address = await worker.share('127.0.0.1', 0, 0, ['only-gpu']);
    const outgoing = await coordinator.invite(address);
    await expect(coordinator.confirm(outgoing.id, sg.fingerprint)).rejects.toThrow(
      'PAIRING_CODE_REQUIRED',
    );
    await worker.decline(outgoing.id);
    await expect(coordinator.confirm(outgoing.id, my.fingerprint)).rejects.toThrow(
      'PAIRING_CODE_REQUIRED',
    );
    await worker.stopSharing();
    expect(worker.snapshot().sharing).toBe(false);
  }, 20_000);

  it.each([false, true])(
    'requires pairing before real stock RPC with residency=%s',
    async (residency) => {
      const gpu = 'GPU-11111111-1111-1111-1111-111111111111';
      const coordinator = new PeerNode(sg, 'SG', []);
      const worker = new PeerNode(
        my,
        'MY',
        [{ id: gpu, name: 'CPU protocol fixture', memoryBytes: 4096 }],
        Object.assign(new DiagnosticRpcBackend('cpu'), { inputResidency: residency }),
      );
      nodes.push(coordinator, worker);
      const address = await worker.share('127.0.0.1', 0, 0, [gpu]);
      const outgoing = await coordinator.invite(address);
      await expect(coordinator.openRpc(outgoing.id)).rejects.toThrow('PEER_NOT_APPROVED');
      await coordinator.verifyCode(
        outgoing.id,
        worker.snapshot().incoming.find((p) => p.id === outgoing.id)!.pairingCode!,
      );
      await worker.approve(outgoing.id, sg.fingerprint);
      const stream = await coordinator.openRpc(outgoing.id);
      async function read(size: number): Promise<Buffer> {
        const chunks: Buffer[] = [];
        let received = 0;
        while (received < size) {
          const part: unknown = stream.read(size - received);
          if (Buffer.isBuffer(part)) {
            chunks.push(part);
            received += part.length;
          } else await once(stream, 'readable');
        }
        return Buffer.concat(chunks, size);
      }
      async function exchange(cmd: number, payload: Buffer, reply = true): Promise<Buffer> {
        const header = Buffer.alloc(9);
        header[0] = cmd;
        header.writeBigUInt64LE(BigInt(payload.length), 1);
        await new Promise<void>((resolve, reject) =>
          stream.write(Buffer.concat([header, payload]), (error) =>
            error ? reject(error) : resolve(),
          ),
        );
        if (!reply) return Buffer.alloc(0);
        const length = Number((await read(8)).readBigUInt64LE());
        expect(length).toBeLessThanOrEqual(65536);
        return read(length);
      }
      expect([...(await exchange(14, Buffer.alloc(24))).subarray(0, 3)]).toEqual([7, 0, 0]);
      if (residency) {
        // A real stock CPU buffer fixture, not model inference. The second SET
        // must restore bytes after MEMSET even though it crosses TLS as a reference.
        const allocation = Buffer.alloc(12);
        allocation.writeBigUInt64LE(1024n, 4);
        const buffer = (await exchange(0, allocation)).subarray(0, 8);
        const base = await exchange(3, buffer);
        const tensor = Buffer.alloc(296);
        tensor.writeBigUInt64LE(1n);
        buffer.copy(tensor, 12);
        base.copy(tensor, 220);
        for (let d = 0; d < 4; d++) {
          tensor.writeUInt32LE(d === 0 ? 128 : 1, 20 + d * 4);
          tensor.writeUInt32LE(d === 0 ? 4 : 512, 36 + d * 4);
        }
        const data = Buffer.alloc(512, 37);
        const set = Buffer.concat([tensor, Buffer.alloc(1), Buffer.alloc(8), data]);
        const range = Buffer.alloc(16);
        range.writeBigUInt64LE(512n, 8);
        const get = Buffer.concat([tensor, range]);
        await exchange(6, set, false);
        expect((await exchange(8, get)).equals(data)).toBe(true);
        await exchange(17, Buffer.concat([tensor, range, Buffer.alloc(1)]), false);
        expect((await exchange(8, get)).equals(Buffer.alloc(512))).toBe(true);
        await exchange(6, set, false);
        expect((await exchange(8, get)).equals(data)).toBe(true);
        expect(stream).toHaveProperty('residencyStats.references', 1);
        await exchange(4, buffer, false);
      }
      stream.destroy();
      await worker.stopSharing();
    },
    30_000,
  );

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
    await coordinator.verifyCode(
      outgoing.id,
      worker.snapshot().incoming.find((p) => p.id === outgoing.id)!.pairingCode!,
    );
    await worker.approve(outgoing.id, sg.fingerprint);
    try {
      const stream = await coordinator.openRpc(outgoing.id);
      // A successful handshake must survive the next expired-lease cleanup tick.
      await new Promise((resolve) => setTimeout(resolve, 1500));
      expect(stream.destroyed).toBe(false);
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
    await coordinator.verifyCode(
      outgoing.id,
      worker.snapshot().incoming.find((p) => p.id === outgoing.id)!.pairingCode!,
    );
    await worker.approve(outgoing.id, sg.fingerprint);
    const stream = await coordinator.openRpc(outgoing.id);
    try {
      await expect(worker.stopSharing()).resolves.toBeUndefined();
      const local = worker.reserveLocal([gpu]);
      worker.releaseLocal(local);
      const restarted = await worker.share('127.0.0.1', 0, 0, [gpu]);
      expect(worker.snapshot().incoming).toMatchObject([
        { phase: 'approved', localVerified: true, remoteVerified: true },
      ]);
      const next = await coordinator.invite(restarted);
      expect((await coordinator.status(next.id)).phase).toBe('approved');
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
    await coordinator.verifyCode(
      outgoing.id,
      worker.snapshot().incoming.find((p) => p.id === outgoing.id)!.pairingCode!,
    );
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
    await coordinator.verifyCode(
      outgoing.id,
      worker.snapshot().incoming.find((p) => p.id === outgoing.id)!.pairingCode!,
    );
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
    await coordinator.verifyCode(
      outgoing.id,
      worker.snapshot().incoming.find((p) => p.id === outgoing.id)!.pairingCode!,
    );
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
