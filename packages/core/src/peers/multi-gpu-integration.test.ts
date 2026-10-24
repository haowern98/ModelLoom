import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { PassThrough } from 'node:stream';
import type { Duplex } from 'node:stream';
import { PeerNode } from './node.js';
import { openWindowsPeerIdentity } from './windows-identity.js';
import type { WindowsPeerIdentity } from './windows-identity.js';
import type { GpuReservations } from './reservations.js';

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
