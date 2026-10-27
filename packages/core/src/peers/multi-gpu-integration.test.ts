import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { PassThrough, duplexPair } from 'node:stream';
import type { Duplex } from 'node:stream';
import { PeerNode } from './node.js';
import { openWindowsPeerIdentity } from './windows-identity.js';
import type { WindowsPeerIdentity } from './windows-identity.js';
import type { GpuReservations } from './reservations.js';
import { once } from 'node:events';
import { createServer as createTlsServer, request as httpsRequest } from 'node:https';
import { connectPeerRpc } from './rpc.js';
import { RPC_RESIDENCY_HEADER, RPC_RESIDENCY_VERSION } from './rpc-residency.js';
import { X509Certificate } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

const a = 'GPU-11111111-1111-1111-1111-111111111111';
const b = 'GPU-22222222-2222-2222-2222-222222222222';
const unshared = 'GPU-33333333-3333-3333-3333-333333333333';
const gpus = [a, b, unshared].map((id) => ({ id, name: id, memoryBytes: 4096 }));
async function rejected(opening: Promise<Duplex>): Promise<boolean> {
  return opening.then(
    (stream) => {
      stream.destroy();
      return false;
    },
    () => true,
  );
}

describe('per-GPU workers over real authenticated TLS', () => {
  let coordinatorIdentity: WindowsPeerIdentity;
  let workerIdentity: WindowsPeerIdentity;
  let otherIdentity: WindowsPeerIdentity;
  const nodes: PeerNode[] = [];
  beforeAll(async () => {
    [coordinatorIdentity, workerIdentity, otherIdentity] = await Promise.all([
      openWindowsPeerIdentity(),
      openWindowsPeerIdentity(),
      openWindowsPeerIdentity(),
    ]);
  }, 30000);
  afterEach(async () => {
    await Promise.all(nodes.splice(0).map((node) => node.close()));
  });
  afterAll(() => {
    coordinatorIdentity?.close();
    workerIdentity?.close();
    otherIdentity?.close();
  });
  async function pair(
    coordinator: PeerNode,
    worker: PeerNode,
    address: string,
    fingerprint: string,
  ) {
    const invited = await coordinator.invite(address);
    await coordinator.verifyCode(
      invited.id,
      worker.snapshot().incoming.find((p) => p.id === invited.id)!.pairingCode!,
    );
    await worker.approve(invited.id, fingerprint);
    return invited.id;
  }
  function fixture() {
    const closes = new Map<string, ReturnType<typeof vi.fn>>();
    const start = vi.fn((ids: readonly string[]) => {
      const stream = new PassThrough();
      const close = vi.fn(() => {
        stream.destroy();
        return Promise.resolve();
      });
      closes.set(ids[0]!, close);
      return Promise.resolve({ stream, close });
    });
    const coordinator = new PeerNode(coordinatorIdentity, 'Coordinator', []);
    const worker = new PeerNode(workerIdentity, 'PTSS', gpus, { start });
    nodes.push(coordinator, worker);
    return { coordinator, worker, start, closes };
  }
  it('negotiates residency over approved TLS with isolated dictionaries and owned GPU cleanup', async () => {
    const closes = new Map<string, ReturnType<typeof vi.fn>>();
    const start = (ids: readonly string[]) => {
      const [stream, native] = duplexPair();
      let pending = Buffer.alloc(0),
        greeted = false;
      native.on('data', (bytes: Buffer) => {
        if (greeted) {
          native.write(bytes);
          return;
        }
        pending = Buffer.concat([pending, bytes]);
        if (pending.length < 9 || pending.length < Number(pending.readBigUInt64LE(1)) + 9) return;
        const response = Buffer.alloc(20);
        response.writeBigUInt64LE(12n);
        response[8] = 8;
        greeted = true;
        native.write(response);
      });
      const close = vi.fn(() => {
        stream.destroy();
        native.destroy();
        return Promise.resolve();
      });
      closes.set(ids[0]!, close);
      return Promise.resolve({ stream, close });
    };
    const coordinator = new PeerNode(coordinatorIdentity, 'Coordinator', []);
    const worker = new PeerNode(workerIdentity, 'Worker', gpus, {
      start,
      ...{ inputResidency: true },
    });
    nodes.push(coordinator, worker);
    const address = await worker.share('127.0.0.1', 0, 0, [a, b]);
    const id = await pair(coordinator, worker, address, coordinatorIdentity.fingerprint);
    const first = await coordinator.openRpc(id, a),
      second = await coordinator.openRpc(id, b);
    async function read(stream: Duplex, count: number) {
      const chunks: Buffer[] = [];
      let size = 0;
      while (size < count) {
        const part: unknown = stream.read(count - size);
        if (Buffer.isBuffer(part)) {
          chunks.push(part);
          size += part.length;
        } else await once(stream, 'readable');
      }
      return Buffer.concat(chunks, count);
    }
    const request = (cmd: number, bytes: Buffer) => {
      const header = Buffer.alloc(9);
      header[0] = cmd;
      header.writeBigUInt64LE(BigInt(bytes.length), 1);
      return Buffer.concat([header, bytes]);
    };
    for (const stream of [first, second]) {
      expect(stream).toHaveProperty('residencyStats');
      const greeting = read(stream, 20);
      stream.write(request(14, Buffer.alloc(16)));
      await greeting;
    }
    const input = request(6, Buffer.alloc(1000, 7));
    for (const stream of [first, first, second]) {
      const restored = read(stream, input.length);
      stream.write(input);
      expect((await restored).equals(input)).toBe(true);
    }
    expect(first).toHaveProperty('residencyStats.references', 1);
    expect(second).toHaveProperty('residencyStats.references', 0);
    first.destroy();
    await vi.waitFor(() => expect(closes.get(a)).toHaveBeenCalledOnce());
    expect(second.destroyed).toBe(false);
    const revoked = once(second, 'close');
    await worker.decline(id);
    await revoked;
    await vi.waitFor(() => expect(closes.get(b)).toHaveBeenCalledOnce());
    expect(second.destroyed).toBe(true);
  });
  it.each(['legacy', 'invalid'] as const)(
    'handles %s remote codec acknowledgements before forwarding native bytes',
    async (mode) => {
      const server = createTlsServer({
        pfx: workerIdentity.pfx,
        ca: new X509Certificate(coordinatorIdentity.authority).toString(),
        requestCert: true,
        rejectUnauthorized: true,
        minVersion: 'TLSv1.3',
      });
      server.on('upgrade', (request, socket) => {
        socket.on('error', () => {});
        expect(request.headers[RPC_RESIDENCY_HEADER]).toBe(RPC_RESIDENCY_VERSION);
        socket.write(
          'HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: ModelLoom-RPC/1\r\n' +
            (mode === 'invalid' ? `${RPC_RESIDENCY_HEADER}: unsupported/2\r\n` : '') +
            '\r\n' +
            (mode === 'legacy' ? 'native reply' : ''),
        );
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw Error('Missing fixture port');
      try {
        const opening = connectPeerRpc(coordinatorIdentity, {
          id: '11111111-1111-1111-1111-111111111111',
          address: '127.0.0.1',
          securePort: address.port,
          certificate: workerIdentity.certificate,
          authority: workerIdentity.authority,
        });
        if (mode === 'invalid') await expect(opening).rejects.toThrow('RPC_RESIDENCY_UNSUPPORTED');
        else {
          const stream = await opening;
          expect(stream).not.toHaveProperty('residencyStats');
          if (!stream.readableLength) await once(stream, 'readable');
          const reply: unknown = stream.read();
          expect(Buffer.isBuffer(reply) && reply.toString()).toBe('native reply');
          stream.destroy();
        }
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    },
  );

  it('keeps old clients on opaque RPC even when the worker supports residency', async () => {
    const stream = new PassThrough();
    const close = vi.fn(() => {
      stream.destroy();
      return Promise.resolve();
    });
    const coordinator = new PeerNode(coordinatorIdentity, 'Coordinator', []);
    const worker = new PeerNode(workerIdentity, 'Worker', gpus, {
      start: () => Promise.resolve({ stream, close }),
      inputResidency: true,
    });
    nodes.push(coordinator, worker);
    const address = await worker.share('127.0.0.1', 0, 0, [a]);
    const id = await pair(coordinator, worker, address, coordinatorIdentity.fingerprint);
    const server = (worker as unknown as { secure: { address(): { port: number } } }).secure;
    const req = httpsRequest({
      host: '127.0.0.1',
      port: server.address().port,
      path: `/v1/rpc/${id}`,
      method: 'POST',
      pfx: coordinatorIdentity.pfx,
      ca: new X509Certificate(workerIdentity.authority).toString(),
      rejectUnauthorized: true,
      checkServerIdentity: (_host, cert) =>
        cert.raw.equals(workerIdentity.certificate)
          ? undefined
          : Error('Unexpected fixture certificate'),
      agent: false,
      headers: { Connection: 'Upgrade', Upgrade: 'ModelLoom-RPC/1', 'X-ModelLoom-GPU': a },
    });
    const upgraded = new Promise<{ response: IncomingMessage; socket: Duplex }>(
      (resolve, reject) => {
        req.once('upgrade', (response, socket) => resolve({ response, socket }));
        req.once('error', reject);
      },
    );
    req.end();
    const { response, socket } = await upgraded;
    expect(response.headers[RPC_RESIDENCY_HEADER]).toBeUndefined();
    const received = new Promise<Buffer>((resolve) => socket.once('data', resolve));
    socket.write('old native bytes');
    expect((await received).toString()).toBe('old native bytes');
    socket.destroy();
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
  });
  it('carries only the coordinator enable flag over authenticated RPC admission', async () => {
    let enabled = true;
    const coordinator = new PeerNode(coordinatorIdentity, 'Coordinator', [], {
      start: () => Promise.reject(Error('Not a worker')),
      cacheEnabled: () => Promise.resolve(enabled),
    });
    const seen: boolean[] = [];
    const owners: (string | undefined)[] = [];
    const worker = new PeerNode(workerIdentity, 'PTSS', gpus, {
      start: (_ids, cache = false, owner) => {
        seen.push(cache);
        owners.push(owner);
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
    const address = await worker.share('127.0.0.1', 0, 0, [a, b]);
    const id = await pair(coordinator, worker, address, coordinatorIdentity.fingerprint);
    const first = await coordinator.openRpc(id, a);
    enabled = false;
    const second = await coordinator.openRpc(id, b);
    expect(seen).toEqual([true, false]);
    expect(owners).toEqual([coordinatorIdentity.fingerprint, undefined]);
    first.destroy();
    second.destroy();
  });
  it('opens independent workers for two GPUs and disconnects only the selected stream', async () => {
    const { coordinator, worker, start, closes } = fixture();
    const address = await worker.share('127.0.0.1', 0, 0, [a, b]);
    const id = await pair(coordinator, worker, address, coordinatorIdentity.fingerprint);
    const first = await coordinator.openRpc(id, a);
    const second = await coordinator.openRpc(id, b);
    expect(start.mock.calls.map(([ids]) => ids)).toEqual([[a], [b]]);
    // Cross the real heartbeat interval so each stream must renew its own GPU.
    await new Promise<void>((resolve) => setTimeout(resolve, 3400));
    expect(first.destroyed).toBe(false);
    expect(second.destroyed).toBe(false);
    first.destroy();
    await vi.waitFor(() => expect(closes.get(a)).toHaveBeenCalledOnce());
    expect(second.destroyed).toBe(false);
    expect(closes.get(b)).not.toHaveBeenCalled();
    const received = new Promise<Buffer>((resolve) => second.once('data', resolve));
    second.write(Buffer.from('GPU B remains usable'));
    expect((await received).toString()).toBe('GPU B remains usable');
    second.destroy();
  });
  it('keeps two overlay GPU streams independent and closes both on revocation', async () => {
    const { coordinator, worker, start, closes } = fixture();
    await worker.share('127.0.0.1', 0, 0, [a, b]);
    coordinator.setOverlay({
      has: (address) => address === '100.101.102.103',
      dial: (_address, port) => {
        const pair = duplexPair();
        // Match the helper's close frame: duplexPair alone does not propagate a
        // destroyed endpoint to its peer as a network transport does.
        pair[0].once('close', () => pair[1].destroy());
        pair[1].once('close', () => pair[0].destroy());
        worker.acceptOverlay(port === 49301 ? 49301 : 49302, pair[1]);
        return Promise.resolve(pair[0]);
      },
    });
    const id = await pair(
      coordinator,
      worker,
      '100.101.102.103:49301',
      coordinatorIdentity.fingerprint,
    );
    const first = await coordinator.openRpc(id, a),
      second = await coordinator.openRpc(id, b);
    expect(start.mock.calls.map(([ids]) => ids)).toEqual([[a], [b]]);
    const received = new Promise<Buffer>((resolve) => second.once('data', resolve));
    second.write('overlay GPU B');
    expect((await received).toString()).toBe('overlay GPU B');
    await worker.decline(id);
    await vi.waitFor(() => {
      expect(closes.get(a)).toHaveBeenCalledOnce();
      expect(closes.get(b)).toHaveBeenCalledOnce();
    });
    await vi.waitFor(() => {
      expect(first.destroyed).toBe(true);
      expect(second.destroyed).toBe(true);
    });
  });
  it('rejects missing, malformed and unshared selectors before native startup', async () => {
    const { coordinator, worker, start } = fixture();
    const address = await worker.share('127.0.0.1', 0, 0, [a, b]);
    const id = await pair(coordinator, worker, address, coordinatorIdentity.fingerprint);
    expect(await rejected(coordinator.openRpc(id))).toBe(true);
    expect(await rejected(coordinator.openRpc(id, 'CUDA0'))).toBe(true);
    expect(await rejected(coordinator.openRpc(id, unshared))).toBe(true);
    expect(start).not.toHaveBeenCalled();
  });
  it('keeps all GPUs busy to a different coordinator while the first owns a worker', async () => {
    const { coordinator, worker, start } = fixture();
    const other = new PeerNode(otherIdentity, 'Other coordinator', []);
    nodes.push(other);
    const address = await worker.share('127.0.0.1', 0, 0, [a, b]);
    const id = await pair(coordinator, worker, address, coordinatorIdentity.fingerprint);
    const otherId = await pair(other, worker, address, otherIdentity.fingerprint);
    const stream = await coordinator.openRpc(id, a);
    expect(await rejected(other.openRpc(otherId, b))).toBe(true);
    expect(start).toHaveBeenCalledExactlyOnceWith([a]);
    stream.destroy();
  });
  it('hot-unplugs one GPU without terminating the other worker', async () => {
    const { coordinator, worker, closes } = fixture();
    const address = await worker.share('127.0.0.1', 0, 0, [a, b]);
    const id = await pair(coordinator, worker, address, coordinatorIdentity.fingerprint);
    const first = await coordinator.openRpc(id, a);
    const second = await coordinator.openRpc(id, b);
    await worker.updateHardware({ os: 'Windows', sampledAt: 1, gpus: [gpus[1]!] });
    await vi.waitFor(() => expect(closes.get(a)).toHaveBeenCalledOnce());
    expect(closes.get(b)).not.toHaveBeenCalled();
    expect(second.destroyed).toBe(false);
    first.destroy();
    second.destroy();
  });
  it('does not admit a prepared worker after its exact reservation has begun release', async () => {
    let started!: () => void;
    const preparing = new Promise<void>((resolve) => {
      started = resolve;
    });
    let finish!: (owned: { stream: PassThrough; close(): Promise<void> }) => void;
    const close = vi.fn(async () => {});
    const coordinator = new PeerNode(coordinatorIdentity, 'Coordinator', []);
    const worker = new PeerNode(workerIdentity, 'PTSS', gpus, {
      start: async (ids) => {
        if (ids[0] === a) return { stream: new PassThrough(), close: async () => {} };
        started();
        return new Promise<{ stream: PassThrough; close(): Promise<void> }>((resolve) => {
          finish = resolve;
        });
      },
    });
    nodes.push(coordinator, worker);
    const address = await worker.share('127.0.0.1', 0, 0, [a, b]);
    const id = await pair(coordinator, worker, address, coordinatorIdentity.fingerprint);
    const first = await coordinator.openRpc(id, a);
    const opening = coordinator.openRpc(id, b);
    void opening.catch(() => undefined);
    await preparing;
    // Force the reservation state independently of GPU topology and peer revision:
    // the admission path must check renewal, not only those other conditions.
    const reservations = (worker as unknown as { reservations: GpuReservations }).reservations;
    const entry = reservations
      .snapshot()
      .reservations.find((entry) => entry.reservation.gpuUuids.includes(b));
    expect(entry).toBeDefined();
    expect(reservations.beginRelease(entry!.reservation)).toBe(true);
    finish({ stream: new PassThrough(), close });
    expect(await rejected(opening)).toBe(true);
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(first.destroyed).toBe(false);
    first.destroy();
  });
  it('revokes both the active worker and a second worker still preparing', async () => {
    let started!: () => void;
    const preparing = new Promise<void>((resolve) => {
      started = resolve;
    });
    let finish!: (owned: { stream: PassThrough; close(): Promise<void> }) => void;
    const firstClose = vi.fn(async () => {});
    const secondClose = vi.fn(async () => {});
    const start = vi.fn(async (ids: readonly string[]) => {
      if (ids[0] === a) return { stream: new PassThrough(), close: firstClose };
      started();
      return new Promise<{ stream: PassThrough; close(): Promise<void> }>((resolve) => {
        finish = resolve;
      });
    });
    const coordinator = new PeerNode(coordinatorIdentity, 'Coordinator', []);
    const worker = new PeerNode(workerIdentity, 'PTSS', gpus, { start });
    nodes.push(coordinator, worker);
    const address = await worker.share('127.0.0.1', 0, 0, [a, b]);
    const id = await pair(coordinator, worker, address, coordinatorIdentity.fingerprint);
    const first = await coordinator.openRpc(id, a);
    const opening = coordinator.openRpc(id, b);
    void opening.catch(() => undefined);
    await preparing;
    await worker.decline(id);
    finish({ stream: new PassThrough(), close: secondClose });
    expect(await rejected(opening)).toBe(true);
    await vi.waitFor(() => {
      expect(firstClose).toHaveBeenCalledOnce();
      expect(secondClose).toHaveBeenCalledOnce();
    });
    first.destroy();
  });
});
