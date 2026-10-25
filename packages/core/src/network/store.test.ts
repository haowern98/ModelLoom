import { mkdtemp, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { openNetworkStore } from './store.js';
const roots: string[] = [];
const protection = {
  available: () => true,
  encrypt: (text: string) => Buffer.from(text.split('').reverse().join('')),
  decrypt: (bytes: Buffer) => bytes.toString().split('').reverse().join(''),
};
async function root() {
  const value = await mkdtemp(path.join(os.tmpdir(), 'loom-network-'));
  roots.push(value);
  return value;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
it('stores only protected bytes and reopens exact enrollment', async () => {
  const directory = await root();
  const store = await openNetworkStore(directory, protection);
  await store.write('machine', Buffer.from('private-node-key'));
  expect((await readFile(path.join(directory, 'enrollment.bin'))).toString()).not.toContain(
    'private-node-key',
  );
  await store.close();
  const next = await openNetworkStore(directory, protection);
  expect((await next.read('machine'))?.toString()).toBe('private-node-key');
  await next.close();
});
it('refuses unavailable encryption and never falls back to a new identity on corruption', async () => {
  const directory = await root();
  await expect(
    openNetworkStore(directory, { ...protection, available: () => false }),
  ).rejects.toThrow('NETWORK_STORAGE_UNAVAILABLE');
  await writeFile(path.join(directory, 'enrollment.bin'), 'corrupt');
  await expect(openNetworkStore(directory, protection)).rejects.toThrow(
    'NETWORK_STORAGE_UNAVAILABLE',
  );
  expect((await readFile(path.join(directory, 'enrollment.bin'))).toString()).toBe('corrupt');
});
it('rejects a second writer and can close repeatedly', async () => {
  const directory = await root();
  const first = await openNetworkStore(directory, protection);
  await expect(openNetworkStore(directory, protection)).rejects.toThrow('NETWORK_STORAGE_BUSY');
  await first.close();
  await first.close();
});
it('does not treat a crash-left lock filename as proof of a live owner', async () => {
  const directory = await root();
  await writeFile(path.join(directory, 'owner.lock'), 'old owner');
  const store = await openNetworkStore(directory, protection);
  await store.close();
});
it('rejects a symlink storage directory', async () => {
  const directory = await root();
  const link = path.join(directory, 'link');
  await symlink(directory, link, process.platform === 'win32' ? 'junction' : 'dir');
  await expect(openNetworkStore(link, protection)).rejects.toThrow('NETWORK_STORAGE_UNAVAILABLE');
});
it('binds a redirected parent to the canonical enrollment domain', async () => {
  const directory = await root();
  const alias = path.join(directory, 'redirected-parent');
  const canonical = path.join(directory, 'private-enrollment');
  await symlink(directory, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const first = await openNetworkStore(path.join(alias, 'private-enrollment'), protection);
  await first.write('machine', Buffer.from('same-identity'));
  await first.close();
  const reopened = await openNetworkStore(canonical, protection);
  expect((await reopened.read('machine'))?.toString()).toBe('same-identity');
  await reopened.close();
});
