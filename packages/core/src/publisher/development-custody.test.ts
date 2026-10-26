import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  initializeCustody,
  checkCustody,
  publishDevelopmentMetadata,
  renewDevelopmentMetadata,
  updateDevelopmentMetadata,
} from './development-custody.js';
import { inventory } from '../../tests/inventory-fixture.js';
import {
  createFixtureVerifier,
  requireLivePackage,
  packageEvidence,
} from '../runtime-package/verifier.js';
const directories: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
it('publishes a changed runtime above prior trusted versions without replacing the root or old repository', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'modelloom-update-'));
  directories.push(directory);
  const store = path.join(directory, 'keys');
  const previous = path.join(directory, 'previous');
  const renewed = path.join(directory, 'renewed');
  const updated = path.join(directory, 'updated');
  await initializeCustody(store);
  await publishDevelopmentMetadata(store, inventory, previous);
  await renewDevelopmentMetadata(store, previous, renewed);
  const root = await readFile(path.join(store, 'public-root.json'));
  const state = path.join(directory, 'state');
  const verifier = createFixtureVerifier(root);
  await verifier.verify(renewed, state);
  const changed = { ...inventory, version: 'fixture-cache-v2' };
  await updateDevelopmentMetadata(store, renewed, changed, updated);
  expect(packageEvidence(await verifier.verify(updated, state)).inventory.version).toBe(
    changed.version,
  );
  for (const role of ['targets', 'snapshot', 'timestamp']) {
    const metadata = JSON.parse(await readFile(path.join(updated, `${role}.json`), 'utf8')) as {
      signed: { version: number };
    };
    expect(metadata.signed.version).toBe(3);
  }
  expect(await readFile(path.join(updated, 'root.json'))).toEqual(root);
  expect(JSON.parse(await readFile(path.join(renewed, 'inventory.json'), 'utf8'))).toEqual(
    inventory,
  );
  await expect(verifier.verify(renewed, state)).rejects.toThrow('PACKAGE_VERIFICATION_FAILED');
  await expect(
    updateDevelopmentMetadata(store, updated, changed, path.join(directory, 'same-version')),
  ).rejects.toThrow('INVENTORY_VERSION_REQUIRED');
  await expect(
    updateDevelopmentMetadata(
      store,
      updated,
      { ...changed, version: 'v3', packageId: 'other' },
      path.join(directory, 'other'),
    ),
  ).rejects.toThrow();
  const timestamp = JSON.parse(await readFile(path.join(updated, 'timestamp.json'), 'utf8')) as {
    signed: { version: number };
  };
  timestamp.signed.version++;
  await writeFile(path.join(updated, 'timestamp.json'), JSON.stringify(timestamp));
  await expect(
    updateDevelopmentMetadata(
      store,
      updated,
      { ...changed, version: 'v3' },
      path.join(directory, 'tampered'),
    ),
  ).rejects.toThrow();
}, 120000);
it('renews expired role metadata with increasing versions, unchanged keys and cached verifier state', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'modelloom-renew-'));
  directories.push(directory);
  const store = path.join(directory, 'keys'),
    previous = path.join(directory, 'previous'),
    renewed = path.join(directory, 'renewed');
  vi.useFakeTimers({ toFake: ['Date'] });
  const issuedAt = Date.now() - 31 * 86400000;
  vi.setSystemTime(issuedAt);
  await initializeCustody(store);
  await publishDevelopmentMetadata(store, inventory, previous);
  const root = await readFile(path.join(store, 'public-root.json'));
  const verifier = createFixtureVerifier(root),
    state = path.join(directory, 'state');
  await verifier.verify(previous, state);
  for (const role of ['targets', 'snapshot', 'timestamp']) {
    const value = JSON.parse(await readFile(path.join(previous, `${role}.json`), 'utf8')) as {
      signed: { expires: string };
    };
    expect(Date.parse(value.signed.expires)).toBe(issuedAt + 30 * 86400000);
  }
  vi.setSystemTime(issuedAt + 29 * 86400000);
  expect((await verifier.verify(previous, state)).packageId).toBe(inventory.packageId);
  vi.setSystemTime(issuedAt + 30 * 86400000);
  await expect(verifier.verify(previous, state)).rejects.toThrow('PACKAGE_VERIFICATION_FAILED');
  vi.useRealTimers();
  await expect(verifier.verify(previous, state)).rejects.toThrow('PACKAGE_VERIFICATION_FAILED');
  const original = await readFile(path.join(previous, 'timestamp.json'), 'utf8');
  await renewDevelopmentMetadata(store, previous, renewed);
  expect((await verifier.verify(renewed, state)).packageId).toBe(inventory.packageId);
  for (const role of ['targets', 'snapshot', 'timestamp']) {
    const value = JSON.parse(await readFile(path.join(renewed, `${role}.json`), 'utf8')) as {
      signed: { version: number };
    };
    expect(value.signed.version).toBe(2);
  }
  expect(await readFile(path.join(renewed, 'root.json'))).toEqual(root);
  expect(await readFile(path.join(renewed, 'inventory.json'))).toEqual(
    await readFile(path.join(previous, 'inventory.json')),
  );
  expect(await readFile(path.join(previous, 'timestamp.json'), 'utf8')).toBe(original);
  const third = path.join(directory, 'third');
  await renewDevelopmentMetadata(store, renewed, third);
  expect((await verifier.verify(third, state)).packageId).toBe(inventory.packageId);
  await expect(verifier.verify(renewed, state)).rejects.toThrow('PACKAGE_VERIFICATION_FAILED');
  const oldInventory = await readFile(path.join(previous, 'inventory.json'));
  await writeFile(
    path.join(previous, 'inventory.json'),
    Buffer.concat([oldInventory, Buffer.from(' ')]),
  );
  await expect(
    renewDevelopmentMetadata(store, previous, path.join(directory, 'changed-inventory')),
  ).rejects.toThrow('INVALID_METADATA');
  await writeFile(path.join(previous, 'inventory.json'), oldInventory);
  await expect(renewDevelopmentMetadata(store, previous, renewed)).rejects.toThrow(
    'REPOSITORY_ALREADY_EXISTS',
  );
  const tampered = JSON.parse(original) as { signed: { version: number } };
  tampered.signed.version = 99;
  await writeFile(path.join(previous, 'timestamp.json'), JSON.stringify(tampered));
  await expect(
    renewDevelopmentMetadata(store, previous, path.join(directory, 'forged')),
  ).rejects.toThrow();
}, 120000);
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
