import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { PeerOwner } from './owner.js';
import { PeerNode } from './node.js';
import { openWindowsPeerIdentity } from './windows-identity.js';
import { PassThrough } from 'node:stream';

const parent = path.resolve('out/peer-owner-tests');
const roots: string[] = [],
  owners: PeerOwner[] = [];
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

it('uses fresh approval after revocation while rejecting pending and ambiguous connections', async () => {
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
        action: 'confirm',
        id,
        fingerprint: identity.fingerprint,
      });
      if (!result.ok) throw Error(result.error);
    };
    const first = await invite();
    const local = await owner.command('owner', { action: 'read' });
    if (!local.ok) throw Error(local.error);
    await worker.approve(first, local.view.fingerprint);
    await confirm(first);
    expect(await owner.resources(device)).toEqual(resources);
    worker.decline(first);
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
    await worker.approve(third, local.view.fingerprint);
    await confirm(third);
    await expect(owner.resources(device)).rejects.toThrow('PEER_NOT_APPROVED');
    await expect(owner.openRpc(device)).rejects.toThrow('PEER_NOT_APPROVED');
  } finally {
    await worker.close();
    identity.close();
  }
}, 30_000);
