import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, it } from 'vitest';
import { PeerTrustStore } from './trust-store.js';

it('persists directional trust, serializes revocation and rejects corrupt or foreign state', async () => {
  const parent = path.resolve('out/peer-trust-tests');
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, 'test-'));
  const protection = async (data: Buffer, protect: boolean) =>
    await Promise.resolve(
      protect ? Buffer.concat([Buffer.from('protected:'), data]) : data.subarray(10),
    );
  expect(root.startsWith(parent + path.sep)).toBe(true);
  try {
    const store = new PeerTrustStore(root, 'a'.repeat(64), protection);
    expect(await store.read()).toEqual([]);
    await store.write([]);
    expect((await readFile(path.join(root, 'trust.dpapi'), 'utf8')).startsWith('protected:')).toBe(
      true,
    );
    await expect(new PeerTrustStore(root, 'b'.repeat(64), protection).read()).rejects.toThrow(
      'PEER_TRUST_UNAVAILABLE',
    );
    await writeFile(path.join(root, 'trust.dpapi'), 'corrupt');
    await expect(store.read()).rejects.toThrow('PEER_TRUST_UNAVAILABLE');
  } finally {
    if (root.startsWith(parent + path.sep)) await rm(root, { recursive: true, force: true });
  }
});
