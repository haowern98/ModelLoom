import { afterEach, expect, it } from 'vitest';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  initializeCustody,
  checkCustody,
  publishDevelopmentMetadata,
} from './development-custody.js';
import { inventory } from '../../tests/inventory-fixture.js';
import { createFixtureVerifier, requireLivePackage } from '../runtime-package/verifier.js';
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
it('stores six DPAPI ciphertexts with separated roles and a self-verified two-of-three public root', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'modelloom-custody-'));
  directories.push(directory);
  const store = path.join(directory, 'keys');
  const receipt = await initializeCustody(store);
  expect(receipt.keyIds).toHaveLength(6);
  expect(new Set(receipt.keyIds).size).toBe(6);
  expect((await readdir(store)).filter((name) => name.endsWith('.dpapi'))).toHaveLength(6);
  expect(await checkCustody(store)).toEqual(receipt);
  const repository = path.join(directory, 'repo');
  await publishDevelopmentMetadata(store, inventory, repository);
  const root = await readFile(path.join(store, 'public-root.json'));
  const capability = await createFixtureVerifier(root).verify(
    repository,
    path.join(directory, 'state'),
  );
  expect(capability.packageId).toBe(inventory.packageId);
  expect(() => requireLivePackage(capability)).toThrow('UNVERIFIED_PACKAGE');
  await expect(initializeCustody(store)).rejects.toThrow('CUSTODY_ALREADY_EXISTS');
  const file = path.join(store, `${receipt.keyIds[0]}.dpapi`);
  const encrypted = await readFile(file);
  expect(encrypted.toString('ascii')).not.toContain('PRIVATE KEY');
  encrypted[encrypted.length - 1] = encrypted[encrypted.length - 1]! ^ 1;
  await writeFile(file, encrypted);
  await expect(checkCustody(store)).rejects.toThrow('INVALID_CUSTODY');
}, 40_000);
it('refuses a partial store without silently generating replacement keys', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'modelloom-partial-custody-'));
  directories.push(directory);
  await writeFile(path.join(directory, 'orphan.dpapi'), 'incomplete');
  await expect(initializeCustody(directory)).rejects.toThrow('CUSTODY_ALREADY_EXISTS');
  expect(await readdir(directory)).toEqual(['orphan.dpapi']);
});
