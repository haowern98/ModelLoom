import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { PeerOwner } from './owner.js';
import { PeerNode } from './node.js';
import { openWindowsPeerIdentity } from './windows-identity.js';
import { PassThrough } from 'node:stream';
import type { Duplex } from 'node:stream';
import type { PeerReply } from './wire.js';
import type { IncomingMessage } from 'node:http';

const parent = path.resolve('out/peer-owner-tests');
const roots: string[] = [],
  owners: PeerOwner[] = [];
it.each(['recover', 'offline', 'revoked', 'removed'] as const)(
  'confirms a transient inventory failure while preserving %s behavior',
  async (outcome) => {
    const owner = await PeerOwner.open(await directory(), 'owner');
    owners.push(owner);
    const identity = await openWindowsPeerIdentity();
    const worker = new PeerNode(identity, 'PTSS', [
      { id: 'gpu-test', name: 'Remote GPU', memoryBytes: 4096 },
    ]);
    const changed = vi.fn<(reply: PeerReply) => void>();
    const unsubscribe = owner.subscribe(changed);
    let watcher: MockInstance<PeerNode['watchInventory']> | undefined;
    try {
      const address = await worker.share('127.0.0.1', 0, 0, ['gpu-test']);
      const invited = await owner.command('owner', { action: 'invite', address });
      if (!invited.ok) throw Error(invited.error);
      const peer = invited.view.outgoing[0]!;
      await owner.command('owner', {
        action: 'verify-code',
        id: peer.id,
        code: worker.snapshot().incoming.find((value) => value.id === peer.id)!.pairingCode!,
      });
      await worker.approve(peer.id, invited.view.fingerprint);
      await vi.waitFor(
        async () => {
          const reply = await owner.command('owner', { action: 'read' });
          expect(reply.ok && reply.view.outgoing[0]?.phase).toBe('approved');
        },
        { timeout: 5000 },
      );
      changed.mockClear();
      const failure = new Error('PEER_UNAVAILABLE', {
        cause: Object.assign(Error('Request deadline exceeded'), { code: 'ETIMEDOUT' }),
      });
      watcher = vi.spyOn(PeerNode.prototype, 'watchInventory');
      if (outcome === 'offline') watcher.mockRejectedValue(failure);
      else watcher.mockRejectedValueOnce(failure);
      await vi.waitFor(() => expect(watcher!.mock.calls.length).toBeGreaterThan(0), {
        timeout: 5000,
      });
      if (outcome === 'revoked') await worker.decline(peer.id);
      if (outcome === 'removed')
        await worker.updateHardware({ os: 'Remote Windows', sampledAt: 2, gpus: [] });
      await vi.waitFor(
        async () => {
          const reply = await owner.command('owner', { action: 'read' });
          if (!reply.ok) throw Error(reply.error);
          const current = reply.view.outgoing[0]!;
          if (outcome === 'offline') expect(current.phase).toBe('disconnected');
          else if (outcome === 'revoked') expect(current.phase).toBe('declined');
          else {
            expect(watcher!.mock.calls.length).toBeGreaterThan(1);
            expect(current.phase).toBe('approved');
            expect(current.gpus).toHaveLength(outcome === 'removed' ? 0 : 1);
          }
        },
        { timeout: 5000 },
      );
      if (outcome !== 'offline')
        expect(
          changed.mock.calls.some(
            ([reply]) =>
              reply.ok && reply.view.outgoing.some((value) => value.phase === 'disconnected'),
          ),
        ).toBe(false);
    } finally {
      watcher?.mockRestore();
      unsubscribe();
      await worker.close();
      identity.close();
    }
  },
  20000,
);
it('opens each approved physical GPU independently without choosing another shared GPU', async () => {
  const owner = await PeerOwner.open(await directory(), 'owner');
  owners.push(owner);
  const identity = await openWindowsPeerIdentity();
  const gpuA = 'GPU-11111111-1111-1111-1111-111111111111';
  const gpuB = 'GPU-22222222-2222-2222-2222-222222222222';
  const unshared = 'GPU-33333333-3333-3333-3333-333333333333';
  const start = vi.fn((gpuIds: readonly string[]) => {
    const stream = new PassThrough();
    stream.write(Buffer.from(gpuIds.join(',')));
    return Promise.resolve({
      stream,
      close: () => {
        stream.destroy();
        return Promise.resolve();
      },
    });
  });
  const worker = new PeerNode(
    identity,
    'Two GPU worker',
    [gpuA, gpuB, unshared].map((id) => ({
      id,
      name: id,
      memoryBytes: 4096,
    })),
    { start },
  );
  try {
    const address = await worker.share('127.0.0.1', 0, 0, [gpuA, gpuB]);
    const invited = await owner.command('owner', { action: 'invite', address });
    if (!invited.ok) throw Error(invited.error);
    const peer = invited.view.outgoing[0]!;
    const verified = await owner.command('owner', {
      action: 'verify-code',
      id: peer.id,
      code: worker.snapshot().incoming.find((value) => value.id === peer.id)!.pairingCode!,
    });
    expect(verified.ok).toBe(true);
    await worker.approve(peer.id, invited.view.fingerprint);
    const first = await owner.openRpc(`peer:${identity.fingerprint}:${gpuA}`);
    const second = await owner.openRpc(`peer:${identity.fingerprint}:${gpuB}`);
    expect(start.mock.calls.map(([ids]) => ids)).toEqual([[gpuA], [gpuB]]);
    first.destroy();
    second.destroy();
    await expect(owner.openRpc(`peer:${identity.fingerprint}:${unshared}`)).rejects.toThrow(
      'GPU_NOT_SHARED',
    );
    expect(start).toHaveBeenCalledTimes(2);
  } finally {
    await worker.close();
    identity.close();
  }
}, 30000);
it.each(['closed', 'revoked', 'recovered'] as const)(
  'keeps a leased RPC session through inventory failures and handles %s',
  async (outcome) => {
    const owner = await PeerOwner.open(await directory(), 'owner');
    owners.push(owner);
    const identity = await openWindowsPeerIdentity();
    const gpu = 'GPU-11111111-1111-1111-1111-111111111111';
    const worker = new PeerNode(identity, 'PTSS', [{ id: gpu, name: 'GPU', memoryBytes: 4096 }], {
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
    const changed = vi.fn<(reply: PeerReply) => void>();
    const unsubscribe = owner.subscribe(changed);
    let watcher: MockInstance<PeerNode['watchInventory']> | undefined;
    let stream: Duplex | undefined;
    try {
      const address = await worker.share('127.0.0.1', 0, 0, [gpu]);
      const invited = await owner.command('owner', { action: 'invite', address });
      if (!invited.ok) throw Error(invited.error);
      const peer = invited.view.outgoing[0]!;
      await owner.command('owner', {
        action: 'verify-code',
        id: peer.id,
        code: worker.snapshot().incoming.find((value) => value.id === peer.id)!.pairingCode!,
      });
      await worker.approve(peer.id, invited.view.fingerprint);
      stream = await owner.openRpc(`peer:${identity.fingerprint}:${gpu}`);
      stream.on('error', () => undefined);
      changed.mockClear();
      watcher = vi.spyOn(PeerNode.prototype, 'watchInventory').mockRejectedValue(
        new Error('PEER_UNAVAILABLE', {
          cause: Object.assign(Error('deadline'), { code: 'ETIMEDOUT' }),
        }),
      );
      await vi.waitFor(() => expect(watcher!.mock.calls.length).toBeGreaterThanOrEqual(4), {
        timeout: 8000,
      });
      expect(stream.destroyed).toBe(false);
      expect(
        changed.mock.calls.some(
          ([reply]) => reply.ok && reply.view.outgoing[0]?.phase === 'disconnected',
        ),
      ).toBe(false);
      const read = await owner.command('owner', { action: 'read' });
      expect(read.ok && read.view.outgoing[0]?.gpus).toHaveLength(1);
      if (outcome === 'recovered') {
        watcher.mockRestore();
        await worker.updateHardware({
          os: 'Recovered',
          sampledAt: 1,
          gpus: [{ id: gpu, name: 'GPU', memoryBytes: 4096 }],
        });
        await vi.waitFor(
          async () => {
            const reply = await owner.command('owner', { action: 'read' });
            expect(reply.ok && reply.view.outgoing[0]?.hardware?.os).toBe('Recovered');
          },
          { timeout: 5000 },
        );
        expect(stream.destroyed).toBe(false);
        return;
      }
      if (outcome === 'revoked') await worker.decline(peer.id);
      else stream.destroy();
      await vi.waitFor(
        async () => {
          const reply = await owner.command('owner', { action: 'read' });
          expect(reply.ok && reply.view.outgoing[0]?.phase).toBe(
            outcome === 'revoked' ? 'declined' : 'disconnected',
          );
        },
        { timeout: 5000 },
      );
    } finally {
      watcher?.mockRestore();
      stream?.destroy();
      unsubscribe();
      await worker.close();
      identity.close();
    }
  },
  30000,
);
async function directory() {
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, 'test-'));
  roots.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(owners.splice(0).map((owner) => owner.close()));
  for (const root of roots.splice(0)) {
    if (!root.startsWith(parent + path.sep)) throw new Error('Unsafe test cleanup');
    await rm(root, { recursive: true, force: true });
  }
});

it('returns local hardware while a remote status check blocks the command queue', async () => {
  const owner = await PeerOwner.open(await directory(), 'owner');
  owners.push(owner);
  const before = await owner.command('owner', { action: 'read' });
  if (!before.ok) throw Error(before.error);
  const identity = await openWindowsPeerIdentity();
  const worker = new PeerNode(identity, 'PTSS', [
    { id: 'gpu', name: 'Remote GPU', memoryBytes: 4096 },
  ]);
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered!: () => void;
  const checking = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const status = vi.spyOn(PeerNode.prototype, 'status').mockImplementation(async () => {
    entered();
    await blocked;
    return { phase: 'pending' };
  });
  let invitation: Promise<PeerReply> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const address = await worker.share('127.0.0.1', 0, 0, ['gpu']);
    invitation = owner.command('owner', { action: 'invite', address });
    await Promise.race([
      checking,
      invitation.then((reply) => {
        throw Error(reply.ok ? 'Remote status was not checked' : reply.error);
      }),
    ]);
    const read = await Promise.race([
      owner.command('owner', { action: 'read' }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Error('Local hardware waited for PTSS')), 500);
      }),
    ]);
    expect(read.ok).toBe(true);
    if (!read.ok) throw Error(read.error);
    expect(read.view.gpus).toEqual(before.view.gpus);
    expect(read.view.addresses).toEqual(before.view.addresses);
    expect(read.view.sharing).toBe(false);
    expect(await owner.command('other', { action: 'read' })).toEqual({
      ok: false,
      error: 'NOT_READY',
    });
  } finally {
    clearTimeout(timer);
    release();
    await invitation;
    status.mockRestore();
    await worker.close();
    identity.close();
  }
}, 20000);

it('refreshes a declined invitation before its verification code has been entered', async () => {
  const owner = await PeerOwner.open(await directory(), 'owner');
  owners.push(owner);
  const identity = await openWindowsPeerIdentity();
  const worker = new PeerNode(identity, 'PTSS', [
    { id: 'gpu', name: 'Remote GPU', memoryBytes: 4096 },
  ]);
  try {
    const address = await worker.share('127.0.0.1', 0, 0, ['gpu']);
    const invited = await owner.command('owner', { action: 'invite', address });
    if (!invited.ok) throw Error(invited.error);
    const id = invited.view.outgoing[0]!.id;
    await worker.decline(id);
    await expect
      .poll(
        async () => {
          const read = await owner.command('owner', { action: 'read' });
          return read.ok && read.view.outgoing.find((peer) => peer.id === id)?.phase;
        },
        { timeout: 2000 },
      )
      .toBe('declined');
    const read = await owner.command('owner', { action: 'read' });
    expect(read.ok && read.view.outgoing[0]?.gpus).toEqual([]);
    expect(read.ok && read.view.outgoing[0]?.localVerified).toBe(false);
  } finally {
    await worker.close();
    identity.close();
  }
}, 20000);

it.each(['INVALID_PEER_MESSAGE', 'UNKNOWN_PEER_OPERATION'])(
  'keeps an approved older peer connected when its reporter rejects the new watch (%s)',
  async (code) => {
    const owner = await PeerOwner.open(await directory(), 'owner');
    owners.push(owner);
    const identity = await openWindowsPeerIdentity();
    const worker = new PeerNode(identity, 'PTSS', [
      { id: 'old-gpu', name: 'Older GPU', memoryBytes: 4096 },
    ]);
    const control = worker as unknown as { control(request: IncomingMessage): Promise<unknown> };
    const original = control.control.bind(worker);
    const unsupported = vi.fn();
    vi.spyOn(control, 'control').mockImplementation((request) => {
      if (request.url === '/v1/inventory-watch') {
        unsupported();
        return Promise.reject(Error(code));
      }
      return original(request);
    });
    try {
      const address = await worker.share('127.0.0.1', 0, 0, ['old-gpu']);
      const invited = await owner.command('owner', { action: 'invite', address });
      if (!invited.ok) throw Error('Fixture invitation failed');
      const peer = invited.view.outgoing[0]!;

      const verified = await owner.command('owner', {
        action: 'verify-code',
        id: peer.id,
        code: worker.snapshot().incoming.find((p) => p.id === peer.id)!.pairingCode!,
      });
      expect(verified).toMatchObject({ ok: true });
      await worker.approve(peer.id, invited.view.fingerprint);
      await vi.waitFor(() => expect(unsupported).toHaveBeenCalled(), { timeout: 5000 });
      await vi.waitFor(async () => {
        const read = await owner.command('owner', { action: 'read' });
        expect(read.ok && read.view.outgoing[0]?.phase).toBe('approved');
        expect(read.ok && read.view.outgoing[0]?.address).toBe('127.0.0.1');
        expect(read.ok && read.view.outgoing[0]?.gpus[0]?.name).toBe('Older GPU');
        expect(read.ok && read.view.outgoing[0]?.hardware).toBeUndefined();
      });
      await worker.stopSharing();
      await vi.waitFor(
        async () => {
          const read = await owner.command('owner', { action: 'read' });
          expect(read.ok && read.view.outgoing[0]?.phase).toBe('disconnected');
        },
        { timeout: 4000 },
      );
    } finally {
      await worker.close();
      identity.close();
    }
  },
  20000,
);

it('publishes remote hardware changes without a read-feedback loop and removes disconnected facts', async () => {
  const owner = await PeerOwner.open(await directory(), 'owner');
  owners.push(owner);
  const identity = await openWindowsPeerIdentity();
  const worker = new PeerNode(identity, 'PTSS', [
    { id: 'gpu-test', name: 'Remote GPU', memoryBytes: 4096 },
  ]);
  const changed = vi.fn<(reply: PeerReply) => void>();
  const unsubscribe = owner.subscribe(changed);
  try {
    const address = await worker.share('127.0.0.1', 0, 0, ['gpu-test']);
    const invited = await owner.command('owner', { action: 'invite', address });
    if (!invited.ok) throw Error('Fixture invitation failed');
    const peer = invited.view.outgoing[0]!;

    await worker.updateHardware({
      os: 'Remote Windows',
      cpuName: 'PTSS CPU',
      sampledAt: 1,
      gpus: [{ id: 'gpu-test', name: 'Remote GPU', memoryBytes: 4096 }],
    });
    const verified = await owner.command('owner', {
      action: 'verify-code',
      id: peer.id,
      code: worker.snapshot().incoming.find((p) => p.id === peer.id)!.pairingCode!,
    });
    expect(verified).toMatchObject({ ok: true });
    await worker.approve(peer.id, invited.view.fingerprint);
    await vi.waitFor(
      () =>
        expect(
          changed.mock.calls.some(
            ([reply]) => reply.ok && reply.view.outgoing[0]?.hardware?.cpuName === 'PTSS CPU',
          ),
        ).toBe(true),
      { timeout: 5000 },
    );
    changed.mockClear();
    const read = await owner.command('owner', { action: 'read' });
    expect(read.ok && read.view.outgoing[0]?.hardware?.os).toBe('Remote Windows');
    expect(changed).not.toHaveBeenCalled();
    await worker.updateHardware({ os: 'Remote Windows', sampledAt: 2, gpus: [] });
    await vi.waitFor(() =>
      expect(
        changed.mock.calls.some(
          ([reply]) =>
            reply.ok &&
            reply.view.outgoing[0]?.phase === 'approved' &&
            reply.view.outgoing[0]?.gpus.length === 0,
        ),
      ).toBe(true),
    );
    await worker.stopSharing();
    await vi.waitFor(() =>
      expect(
        changed.mock.calls.some(
          ([reply]) =>
            reply.ok &&
            reply.view.outgoing[0]?.phase === 'disconnected' &&
            !reply.view.outgoing[0]?.hardware,
        ),
      ).toBe(true),
    );
  } finally {
    unsubscribe();
    await worker.close();
    identity.close();
  }
}, 20000);
it('persists the protected identity across owner replacement, starts sharing off, and rejects a different caller', async () => {
  const root = await directory();
  const first = await PeerOwner.open(root, 'owner');
  owners.push(first);
  const before = await first.command('owner', { action: 'read' });
  expect(before.ok).toBe(true);
  if (!before.ok) throw new Error('Owner never opened');
  expect(await first.command('other', { action: 'read' })).toEqual({
    ok: false,
    error: 'NOT_READY',
  });
  await first.close();
  owners.splice(owners.indexOf(first), 1);
  const second = await PeerOwner.open(root, 'owner');
  owners.push(second);
  const after = await second.command('owner', { action: 'read' });
  expect(after.ok).toBe(true);
  if (!after.ok) throw new Error('Owner never reopened');
  expect(after.view.fingerprint).toBe(before.view.fingerprint);
  expect(after.view.sharing).toBe(false);
  expect(after.view.incoming).toEqual([]);
}, 20_000);
it('preserves corrupt identity data and refuses to silently replace its public identity', async () => {
  const root = await directory();
  const first = await PeerOwner.open(root, 'owner');
  await first.close();
  const filename = path.join(root, 'peers/identity.dpapi');
  const corrupt = Buffer.from('broken identity');
  await writeFile(filename, corrupt);
  await expect(PeerOwner.open(root, 'owner')).rejects.toThrow();
  expect(await readFile(filename)).toEqual(corrupt);
}, 20_000);
it('does not advertise sharing when its verified runtime cannot be installed', async () => {
  const resources = vi.fn(() => Promise.reject(Error('RPC_PACKAGE_REQUIRED')));
  const start = vi.fn();
  const owner = await PeerOwner.open(await directory(), 'owner', { resources, start });
  owners.push(owner);
  const before = await owner.command('owner', { action: 'read' });
  if (!before.ok || !before.view.addresses[0] || !before.view.gpus[0])
    throw Error('Native inventory unavailable');
  expect(
    await owner.command('owner', {
      action: 'share',
      address: before.view.addresses[0],
      gpuIds: [before.view.gpus[0].id],
    }),
  ).toEqual({ ok: false, error: 'RPC_PACKAGE_REQUIRED' });
  const after = await owner.command('owner', { action: 'read' });
  expect(after.ok && after.view.sharing).toBe(false);
  expect(resources).toHaveBeenCalledWith([]);
  expect(start).not.toHaveBeenCalled();
}, 20_000);

it('uses fresh approval after revocation and deduplicates remembered connections', async () => {
  const owner = await PeerOwner.open(await directory(), 'owner');
  owners.push(owner);
  const identity = await openWindowsPeerIdentity();
  const gpu = 'GPU-11111111-1111-1111-1111-111111111111';
  const resources = {
    runtimeId: 'a'.repeat(64),
    ram: 1024 ** 3,
    gpus: [
      {
        uuid: gpu,
        bus: '00000000:01:00.0',
        driver: '580.1',
        total: 4096,
        free: 4096,
        mig: 'Disabled' as const,
        driverModel: 'WDDM' as const,
      },
    ],
  };
  const start = vi.fn(() => {
    const stream = new PassThrough();
    return Promise.resolve({
      stream,
      close: () => {
        stream.destroy();
        return Promise.resolve();
      },
    });
  });
  const worker = new PeerNode(
    identity,
    'Worker',
    [{ id: gpu, name: 'Fixture', memoryBytes: 4096 }],
    {
      resources: () => Promise.resolve(resources),
      start,
    },
  );
  try {
    const address = await worker.share('127.0.0.1', 0, 0, [gpu]);
    const device = `peer:${identity.fingerprint}:${gpu}`;
    const invite = async () => {
      const result = await owner.command('owner', { action: 'invite', address });
      if (!result.ok) throw Error(result.error);
      return result.view.outgoing.at(-1)!.id;
    };
    const confirm = async (id: string) => {
      const result = await owner.command('owner', {
        action: 'verify-code',
        id,
        code: worker.snapshot().incoming.find((p) => p.id === id)!.pairingCode!,
      });
      if (!result.ok) throw Error(result.error);
    };
    const first = await invite();
    const local = await owner.command('owner', { action: 'read' });
    if (!local.ok) throw Error(local.error);
    await confirm(first);
    await worker.approve(first, local.view.fingerprint);
    expect(await owner.resources(device)).toEqual(resources);
    await worker.decline(first);
    await expect(owner.resources(device)).rejects.toThrow();
    await expect(owner.openRpc(device)).rejects.toThrow();
    const second = await invite();
    await confirm(second);
    await expect(owner.resources(device)).rejects.toThrow();
    await expect(owner.openRpc(device)).rejects.toThrow();
    expect(start).not.toHaveBeenCalled();
    await worker.approve(second, local.view.fingerprint);
    expect(await owner.resources(device)).toEqual(resources);
    const stream = await owner.openRpc(device);
    stream.destroy();
    const third = await invite();
    const reconnected = await owner.command('owner', { action: 'read' });
    expect(reconnected.ok && reconnected.view.outgoing.find((p) => p.id === third)?.phase).toBe(
      'approved',
    );
    expect(
      reconnected.ok &&
        reconnected.view.outgoing.filter((p) => p.peerFingerprint === identity.fingerprint),
    ).toHaveLength(1);
    expect(await owner.resources(device)).toEqual(resources);
    const incomingBeforeDisconnect = worker.snapshot().incoming.map((peer) => peer.id);
    const active = await owner.openRpc(device);
    const disconnected = await owner.command('owner', { action: 'disconnect', id: third });
    expect(disconnected.ok && disconnected.view.outgoing[0]?.phase).toBe('disconnected');
    expect(disconnected.ok && disconnected.view.outgoing[0]?.localVerified).toBe(true);
    await vi.waitFor(() => expect(active.destroyed).toBe(true));
    // A retry queued before the user's click must not resume the peer afterward.
    await owner.command('owner', { action: 'invite', address }, true);
    const paused = await owner.command('owner', { action: 'read' });
    expect(paused.ok && paused.view.outgoing[0]?.phase).toBe('disconnected');
    await expect(owner.resources(device)).rejects.toThrow('PEER_NOT_APPROVED');
    await expect(owner.openRpc(device)).rejects.toThrow('PEER_NOT_APPROVED');
    const resumed = await owner.command('owner', {
      action: 'invite',
      address,
      expectedFingerprint: identity.fingerprint,
    });
    expect(resumed.ok && resumed.view.outgoing[0]?.phase).toBe('approved');
    expect(worker.snapshot().incoming.map((peer) => peer.id)).toEqual(incomingBeforeDisconnect);
  } finally {
    await worker.close();
    identity.close();
  }
}, 30_000);
