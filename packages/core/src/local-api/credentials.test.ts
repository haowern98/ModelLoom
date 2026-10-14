import { expect, it } from 'vitest';
import { ApiCredentials } from './credentials.js';
import { requireApiCaller } from '../generation/api-authority.js';
import type { ProtectedApiCredential } from '../model-configuration/store.js';
import type { ApiKeyProtection } from '../model-configuration/windows-protection.js';
function fixture() {
  let saved: ProtectedApiCredential | null = null,
    failed = false,
    revoked = 0;
  const opaque = new Map<string, Buffer>();
  let next = 0;
  // Synthetic opaque protection fixture; production uses the Windows adapter only.
  const protection: ApiKeyProtection = {
    protect(key) {
      const id = Buffer.from(`protected-${++next}`);
      opaque.set(id.toString(), Buffer.from(key));
      return id;
    },
    unprotect(cipher) {
      const key = opaque.get(cipher.toString());
      if (!key) throw new Error('private');
      return Buffer.from(key);
    },
  };
  const repository = {
    readCredential: () => Promise.resolve(saved),
    replaceCredential: (generation: number, protectedKey: Buffer) => {
      if (failed) return Promise.reject(new Error('private disk path'));
      if (generation !== (saved?.generation ?? 0)) return Promise.reject(new Error('stale'));
      saved = { generation: generation + 1, protectedKey: Buffer.from(protectedKey) };
      return Promise.resolve(saved);
    },
  };
  return {
    protection,
    repository,
    fail: () => {
      failed = true;
    },
    saved: () => saved,
    revoke: () => {
      revoked++;
      return Promise.resolve();
    },
    revoked: () => revoked,
  };
}
it('requires explicit generation, recovers a key after restart and rotates transactionally', async () => {
  const f = fixture();
  const credentials = await ApiCredentials.open(f.repository, f.protection, f.revoke);
  expect(credentials.status()).toEqual({ present: false, generation: 0 });
  expect(credentials.authenticate('anything')).toBeNull();
  await credentials.generate();
  const first = credentials.reveal();
  expect(first).toMatch(/^ml_[a-f0-9]{64}$/u);
  expect(f.saved()!.protectedKey.includes(first)).toBe(false);
  const caller = credentials.authenticate(first);
  if (!caller) throw new Error('Missing synthetic caller');
  expect(requireApiCaller(caller)).toMatch(/^api-/u);
  await credentials.generate();
  expect(credentials.status()).toEqual({ present: true, generation: 2 });
  expect(credentials.authenticate(first)).toBeNull();
  expect(() => requireApiCaller(caller)).toThrow('DENIED');
  expect(f.revoked()).toBe(2);
  const second = credentials.reveal();
  credentials.close();
  const restarted = await ApiCredentials.open(f.repository, f.protection, f.revoke);
  expect(restarted.authenticate(second)).not.toBeNull();
  f.fail();
  await expect(restarted.generate()).rejects.toThrow('CREDENTIAL_UNAVAILABLE');
  expect(restarted.reveal()).toBe(second);
  expect(restarted.status().generation).toBe(2);
  expect(restarted.authenticate(second)).not.toBeNull();
  restarted.close();
  expect(restarted.authenticate(second)).toBeNull();
  expect(() => restarted.reveal()).toThrow('CREDENTIAL_UNAVAILABLE');
});
it('fails closed when protection or recovery fails, with no plaintext save', async () => {
  const f = fixture();
  let writes = 0;
  const credentials = await ApiCredentials.open(
    {
      ...f.repository,
      replaceCredential: () => {
        writes++;
        return Promise.reject(new Error('unexpected'));
      },
    },
    {
      protect: () => {
        throw new Error('private platform failure');
      },
      unprotect: (input) => f.protection.unprotect(input),
    },
    f.revoke,
  );
  await expect(credentials.generate()).rejects.toThrow('CREDENTIAL_UNAVAILABLE');
  expect(writes).toBe(0);
  expect(credentials.status().present).toBe(false);
  credentials.close();
  await expect(
    ApiCredentials.open(
      {
        readCredential: () =>
          Promise.resolve({ generation: 1, protectedKey: Buffer.from('unknown') }),
        replaceCredential: f.repository.replaceCredential,
      },
      f.protection,
      f.revoke,
    ),
  ).rejects.toThrow('CREDENTIAL_UNAVAILABLE');
});
