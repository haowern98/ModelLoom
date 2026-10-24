import { describe, expect, it } from 'vitest';
import { GpuReservations } from './reservations.js';

const gpu0 = 'GPU-00000000-0000-0000-0000-000000000001';
const gpu1 = 'GPU-00000000-0000-0000-0000-000000000002';
const peer = 'a'.repeat(64);
const otherPeer = 'b'.repeat(64);
function setup() {
  let now = 0;
  const reservations = new GpuReservations([gpu0, gpu1], 30_000, () => now);
  return { reservations, advance: (milliseconds: number) => (now += milliseconds) };
}

describe('worker GPU reservations', () => {
  it('invalidates removed physical GPUs without losing the reservation cleanup handle', () => {
    const { reservations } = setup();
    reservations.setShared([gpu0]);
    const held = reservations.reserveRemote(peer, [gpu0]);
    reservations.updateDevices([gpu1]);
    expect(reservations.pendingRelease()).toContain(held);
    expect(reservations.renew(held)).toBe(false);
    expect(() => reservations.reserveLocal([gpu0])).toThrow();
    expect(reservations.confirmReleased(held)).toBe(true);
    reservations.updateDevices([gpu0, gpu1]);
    expect(reservations.reserveLocal([gpu0]).gpuUuids).toEqual([gpu0]);
  });
  it('starts independent and does not reserve hardware when sharing is enabled', () => {
    const { reservations } = setup();
    expect(reservations.snapshot()).toEqual({ shared: [], reservations: [] });
    reservations.setShared([gpu1]);
    expect(reservations.snapshot()).toEqual({ shared: [gpu1], reservations: [] });
    expect(() => reservations.reserveRemote(peer, [gpu0])).toThrow('GPU_NOT_SHARED');
    const local = reservations.reserveLocal([gpu1]);
    expect(local.kind).toBe('local');
  });

  it('rejects a remote load while the requested GPU is already used locally', () => {
    const { reservations } = setup();
    reservations.setShared([gpu0, gpu1]);
    reservations.reserveLocal([gpu1]);
    expect(() => reservations.reserveRemote(peer, [gpu0, gpu1])).toThrow('GPU_BUSY');
    expect(reservations.snapshot().reservations).toHaveLength(1);
    // Failed multi-GPU acquisition must not leave a partial reservation on GPU 0.
    expect(reservations.reserveRemote(peer, [gpu0]).gpuUuids).toEqual([gpu0]);
  });

  it('rejects competing local work but allows an unreserved GPU', () => {
    const { reservations } = setup();
    reservations.setShared([gpu1]);
    reservations.reserveRemote(peer, [gpu1]);
    expect(() => reservations.reserveLocal([gpu1])).toThrow('GPU_BUSY');
    expect(reservations.reserveLocal([gpu0]).gpuUuids).toEqual([gpu0]);
  });

  it('allows disjoint handles for the same peer but rejects competing peers and overlap', () => {
    const { reservations } = setup();
    reservations.setShared([gpu0, gpu1]);
    reservations.reserveRemote(peer, [gpu0]);
    expect(() => reservations.reserveRemote(otherPeer, [gpu1])).toThrow('GPU_BUSY');
    const second = reservations.reserveRemote(peer, [gpu1]);
    expect(second.gpuUuids).toEqual([gpu1]);
    expect(reservations.snapshot().reservations).toHaveLength(2);
    expect(() => reservations.reserveRemote(peer, [gpu0])).toThrow('GPU_BUSY');
    expect(() => reservations.reserveRemote(peer, [gpu0, gpu1])).toThrow('GPU_BUSY');
    expect(() => reservations.reserveLocal([gpu1])).toThrow('GPU_BUSY');
  });

  it('renews and expires disjoint handles independently without releasing live hardware', () => {
    const { reservations, advance } = setup();
    reservations.setShared([gpu0, gpu1]);
    const first = reservations.reserveRemote(peer, [gpu0]);
    const second = reservations.reserveRemote(peer, [gpu1]);
    advance(20_000);
    expect(reservations.renew(second)).toBe(true);
    advance(10_000);
    expect(reservations.pendingRelease()).toEqual([first]);
    expect(reservations.renew(first)).toBe(false);
    expect(() => reservations.reserveLocal([gpu0])).toThrow('GPU_BUSY');
    expect(reservations.confirmReleased(first)).toBe(true);
    expect(reservations.snapshot().reservations).toEqual([
      { reservation: second, state: 'active', expiresAt: 50_000 },
    ]);
    expect(reservations.reserveLocal([gpu0]).kind).toBe('local');
    advance(20_000);
    expect(reservations.pendingRelease()).toEqual([second]);
  });

  it.each(['sharing', 'hardware'] as const)(
    'invalidates only affected handles on %s changes',
    (change) => {
      const { reservations } = setup();
      reservations.setShared([gpu0, gpu1]);
      const first = reservations.reserveRemote(peer, [gpu0]);
      const second = reservations.reserveRemote(peer, [gpu1]);
      if (change === 'sharing') reservations.setShared([gpu1]);
      else reservations.updateDevices([gpu1]);
      expect(reservations.pendingRelease()).toEqual([first]);
      expect(reservations.renew(first)).toBe(false);
      expect(reservations.renew(second)).toBe(true);
      expect(reservations.confirmReleased(first)).toBe(true);
      expect(reservations.snapshot().reservations.map((entry) => entry.reservation)).toEqual([
        second,
      ]);
    },
  );

  it('cannot use stale or copied handles to release another handle owned by the same peer', () => {
    const { reservations } = setup();
    reservations.setShared([gpu0, gpu1]);
    const first = reservations.reserveRemote(peer, [gpu0]);
    const second = reservations.reserveRemote(peer, [gpu1]);
    expect(reservations.beginRelease({ ...second })).toBe(false);
    expect(reservations.confirmReleased({ ...second })).toBe(false);
    expect(reservations.renew({ ...second })).toBe(false);
    expect(reservations.beginRelease(first)).toBe(true);
    expect(reservations.confirmReleased(first)).toBe(true);
    const replacement = reservations.reserveRemote(peer, [gpu0]);
    expect(reservations.beginRelease(first)).toBe(false);
    expect(reservations.confirmReleased(first)).toBe(false);
    expect(reservations.renew(second)).toBe(true);
    expect(reservations.renew(replacement)).toBe(true);
    expect(reservations.pendingRelease()).toEqual([]);
    expect(reservations.snapshot().reservations.map((entry) => entry.reservation)).toEqual(
      expect.arrayContaining([second, replacement]),
    );
  });

  it('retains ownership until teardown is confirmed after sharing stops', () => {
    const { reservations } = setup();
    reservations.setShared([gpu1]);
    const remote = reservations.reserveRemote(peer, [gpu1]);
    const local = reservations.reserveLocal([gpu0]);
    reservations.setShared([]);
    expect(reservations.pendingRelease()).toEqual([remote]);
    expect(reservations.snapshot().reservations).toEqual([
      { reservation: local, state: 'active', expiresAt: null },
      { reservation: remote, state: 'releasing', expiresAt: 30_000 },
    ]);
    expect(reservations.renew(remote)).toBe(false);
    reservations.setShared([gpu1]);
    expect(() => reservations.reserveRemote(peer, [gpu1])).toThrow('GPU_BUSY');
    expect(reservations.confirmReleased(remote)).toBe(true);
    expect(reservations.reserveRemote(peer, [gpu1])).not.toBe(remote);
  });

  it('releases only an assignment that uses a GPU removed from sharing', () => {
    const { reservations } = setup();
    reservations.setShared([gpu0, gpu1]);
    const remote = reservations.reserveRemote(peer, [gpu1]);
    reservations.setShared([gpu1]);
    expect(reservations.pendingRelease()).toEqual([]);
    reservations.setShared([gpu0]);
    expect(reservations.pendingRelease()).toEqual([remote]);
  });

  it('expires at the deadline and rejects a late heartbeat without freeing busy hardware', () => {
    const { reservations, advance } = setup();
    reservations.setShared([gpu1]);
    const remote = reservations.reserveRemote(peer, [gpu1]);
    advance(30_000);
    expect(reservations.renew(remote)).toBe(false);
    expect(reservations.pendingRelease()).toEqual([remote]);
    expect(() => reservations.reserveLocal([gpu1])).toThrow('GPU_BUSY');
    expect(reservations.confirmReleased(remote)).toBe(true);
    expect(reservations.reserveLocal([gpu1]).kind).toBe('local');
  });

  it('renews only the current live assignment', () => {
    const { reservations, advance } = setup();
    reservations.setShared([gpu1]);
    const remote = reservations.reserveRemote(peer, [gpu1]);
    advance(20_000);
    expect(reservations.renew(remote)).toBe(true);
    advance(10_000);
    expect(reservations.pendingRelease()).toEqual([]);
    expect(reservations.snapshot().reservations[0]?.expiresAt).toBe(50_000);
    advance(20_000);
    expect(reservations.pendingRelease()).toEqual([remote]);
  });

  it('ignores stale disconnects and forged handles after reconnect', () => {
    const { reservations } = setup();
    reservations.setShared([gpu1]);
    const old = reservations.reserveRemote(peer, [gpu1]);
    expect(reservations.confirmReleased(old)).toBe(false);
    expect(reservations.beginRelease(old)).toBe(true);
    expect(reservations.confirmReleased(old)).toBe(true);
    const current = reservations.reserveRemote(peer, [gpu1]);
    expect(reservations.beginRelease(old)).toBe(false);
    expect(reservations.beginRelease({ ...current })).toBe(false);
    expect(reservations.confirmReleased({ ...current })).toBe(false);
    expect(reservations.renew({ ...current })).toBe(false);
    expect(reservations.pendingRelease()).toEqual([]);
    expect(reservations.snapshot().reservations[0]?.reservation).toBe(current);
  });

  it('keeps failed teardown reserved and releases local work explicitly', () => {
    const { reservations } = setup();
    const local = reservations.reserveLocal([gpu0]);
    expect(reservations.beginRelease(local)).toBe(true);
    expect(reservations.pendingRelease()).toEqual([local]);
    expect(() => reservations.reserveLocal([gpu0])).toThrow('GPU_BUSY');
    expect(reservations.confirmReleased(local)).toBe(true);
    expect(reservations.confirmReleased(local)).toBe(false);
    expect(reservations.reserveLocal([gpu0])).not.toBe(local);
  });

  it('validates identities and GPU lists before changing ownership', () => {
    const { reservations } = setup();
    reservations.setShared([gpu1]);
    const before = reservations.snapshot();
    for (const invalid of [[], [gpu1, gpu1.toLowerCase()], ['CUDA0'], ['GPU-unknown']]) {
      expect(() => reservations.reserveLocal(invalid)).toThrow('INVALID_GPU_RESERVATION');
      expect(() => reservations.reserveRemote(peer, invalid)).toThrow('INVALID_GPU_RESERVATION');
    }
    expect(() => reservations.reserveRemote('ptss', [gpu1])).toThrow('INVALID_PEER_IDENTITY');
    expect(() => reservations.setShared(['CUDA0'])).toThrow('INVALID_GPU_RESERVATION');
    expect(reservations.snapshot()).toEqual(before);
  });

  it('normalizes GPU case to inventory identities and freezes returned state', () => {
    const { reservations } = setup();
    const shared = [gpu1.toLowerCase()];
    reservations.setShared(shared);
    shared.length = 0;
    const remote = reservations.reserveRemote(peer, [gpu1.toLowerCase()]);
    expect(remote.gpuUuids).toEqual([gpu1]);
    expect(Object.isFrozen(remote)).toBe(true);
    expect(Object.isFrozen(remote.gpuUuids)).toBe(true);
    const snapshot = reservations.snapshot();
    expect(Object.isFrozen(snapshot.shared)).toBe(true);
    expect(Object.isFrozen(snapshot.reservations[0])).toBe(true);
  });

  it('rejects invalid lease clocks and fails closed if the clock moves backward', () => {
    expect(() => new GpuReservations([gpu0], 0, () => 0)).toThrow('INVALID_GPU_RESERVATION');
    expect(() => new GpuReservations([gpu0, gpu0.toLowerCase()], 1, () => 0)).toThrow(
      'INVALID_GPU_RESERVATION',
    );
    let now = 100;
    const reservations = new GpuReservations([gpu0], 1000, () => now);
    reservations.setShared([gpu0]);
    const remote = reservations.reserveRemote(peer, [gpu0]);
    now = 99;
    expect(() => reservations.renew(remote)).toThrow('INVALID_RESERVATION_CLOCK');
    now = 100;
    expect(reservations.snapshot().reservations[0]?.reservation).toBe(remote);
  });
});
