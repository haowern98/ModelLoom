import type { VerifiedPackage } from './verifier.js';
import { packageEvidence, requireLivePackage } from './verifier.js';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, lstat, mkdir, opendir, rm, statfs } from 'node:fs/promises';
import path from 'node:path';
import { ownershipBinding } from '../hosts/windows-ownership.js';
import type { Inventory } from './inventory.js';
export interface InstalledPackage {
  readonly packageId: string;
  readonly directory: string;
}
const installedPackages = new WeakMap<object, VerifiedPackage>();
const installations = new Map<string, Promise<void>>();
/** Only verifier-issued live packages can reach the production broker; fixture receipts never promote. */
export function requireInstalledLive(installed: InstalledPackage): Inventory {
  const capability = installedPackages.get(installed);
  if (!capability) throw new Error('UNVERIFIED_PACKAGE');
  return requireLivePackage(capability).inventory;
}
/** Realm comes from the retained verifier capability, never a caller-supplied install field. */
export function installedRealm(installed: InstalledPackage): 'live' | 'development' {
  const capability = installedPackages.get(installed);
  const realm = requireLivePackage(capability).realm;
  if (realm !== 'live' && realm !== 'development') throw new Error('UNVERIFIED_PACKAGE');
  return realm;
}
async function inspect(directory: string, inventory: Inventory): Promise<void> {
  const files = inventory.files;
  const expected = new Set(files.map((file) => file.path));
  let entries = 0;
  async function scan(relative: string) {
    const current = path.join(directory, relative);
    const stat = await lstat(current);
    if (stat.isSymbolicLink()) throw new Error('INVALID_TREE');
    if (stat.isDirectory()) {
      if (++entries > 1024) throw new Error('INVALID_TREE');
      const stream = await opendir(current);
      for await (const entry of stream) {
        if (++entries > 1024) throw new Error('INVALID_TREE');
        await scan(relative ? `${relative}/${entry.name}` : entry.name);
      }
    } else if (!stat.isFile() || !expected.delete(relative)) throw new Error('UNEXPECTED_FILE');
  }
  await scan('');
  if (expected.size) throw new Error('MISSING_FILE');
  for (const file of files) {
    const current = path.join(directory, file.path),
      stat = await lstat(current);
    if (stat.size !== file.length) throw new Error('FILE_MISMATCH');
    const digest = createHash('sha256');
    for await (const chunk of createReadStream(current)) {
      const bytes: unknown = chunk;
      if (!Buffer.isBuffer(bytes)) throw new Error('INVALID_FILE');
      digest.update(bytes);
    }
    if (digest.digest('hex') !== file.sha256) throw new Error('FILE_MISMATCH');
  }
}
function receipt(capability: VerifiedPackage, directory: string): InstalledPackage {
  const { inventory } = packageEvidence(capability);
  const result = Object.freeze({ packageId: inventory.packageId, directory });
  installedPackages.set(result, capability);
  return result;
}

/** Find an installed copy matching signed metadata, without installing or modifying files. */
export async function findInstalledRuntime(
  capability: VerifiedPackage,
  root: string,
): Promise<InstalledPackage | undefined> {
  const { inventory } = packageEvidence(capability);
  const prefix = `${inventory.packageId}-${inventory.version}-`;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const stream = await opendir(root).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  });
  if (!stream) return undefined;
  let entries = 0;
  for await (const entry of stream) {
    if (++entries > 1024) throw new Error('INVALID_TREE');
    if (!entry.isDirectory() || !entry.name.startsWith(prefix)) continue;
    if (!uuid.test(entry.name.slice(prefix.length))) continue;
    const result = receipt(capability, path.join(root, entry.name));
    try {
      // A directory name is only a hint. Current signed inventory and native locks grant reuse.
      const lock = await revalidateInstalled(result);
      lock.release();
      return result;
    } catch {
      // Preserve damaged or older copies; never overwrite a potentially retained installation.
    }
  }
  return undefined;
}

/** Expanded bootstrap only. Reuse requires fresh verification against this caller's capability. */
export async function installExpanded(
  capability: VerifiedPackage,
  bundle: string,
  root: string,
): Promise<InstalledPackage> {
  const directory = path.resolve(root);
  const key = process.platform === 'win32' ? directory.toLowerCase() : directory;
  const previous = installations.get(key);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  installations.set(key, pending);
  await previous;
  try {
    return await installSerialized(capability, bundle, directory);
  } finally {
    release();
    if (installations.get(key) === pending) installations.delete(key);
  }
}

async function installSerialized(
  capability: VerifiedPackage,
  bundle: string,
  root: string,
): Promise<InstalledPackage> {
  const native = ownershipBinding();
  let source: object | undefined, candidate: string | undefined;
  try {
    const { inventory } = packageEvidence(capability);
    source = native.sealFiles(inventory.files.map((file) => path.resolve(bundle, file.path)));
    await inspect(bundle, inventory);
    native.privateDirectory(root);
    const existing = await findInstalledRuntime(capability, root);
    if (existing) return existing;
    const space = await statfs(root, { bigint: true });
    const required = inventory.files.reduce((bytes, file) => bytes + BigInt(file.length), 0n);
    if (space.bavail * space.bsize < required) throw new Error('INSUFFICIENT_DISK_SPACE');
    candidate = path.join(root, `${inventory.packageId}-${inventory.version}-${randomUUID()}`);
    native.privateDirectory(candidate);
    for (const file of inventory.files) {
      const destination = path.join(candidate, file.path);
      await mkdir(path.dirname(destination), { recursive: true });
      await copyFile(path.join(bundle, file.path), destination);
    }
    const result = receipt(capability, candidate);
    const lock = await revalidateInstalled(result);
    lock.release();
    candidate = undefined;
    return result;
  } catch (error) {
    let cleanupFailure: unknown;
    if (candidate) {
      try {
        await rm(candidate, { recursive: true, force: true });
      } catch (cleanupError) {
        cleanupFailure = cleanupError;
      }
    }
    throw installationError(error, cleanupFailure);
  } finally {
    if (source) native.releaseFiles(source);
  }
}

function installationError(error: unknown, cleanupFailure: unknown): Error {
  const insufficient =
    error instanceof Error &&
    (error.message === 'INSUFFICIENT_DISK_SPACE' || ('code' in error && error.code === 'ENOSPC'));
  const cause =
    cleanupFailure === undefined
      ? error
      : new AggregateError([error, cleanupFailure], 'Installation and partial cleanup failed');
  return new Error(insufficient ? 'INSUFFICIENT_DISK_SPACE' : 'INSTALL_FAILED', { cause });
}
/** Rehash every dependency with native file and ancestor handles retained until the consumer releases. */
export async function revalidateInstalled(
  installed: InstalledPackage,
): Promise<{ release(): void }> {
  const native = ownershipBinding();
  const files: object[] = [];
  try {
    const capability = installedPackages.get(installed);
    if (!capability) throw new Error('UNVERIFIED_PACKAGE');
    const { inventory } = packageEvidence(capability);
    files.push(
      native.sealFiles(inventory.files.map((file) => path.join(installed.directory, file.path))),
    );
    await inspect(installed.directory, inventory);
    const captured = files.splice(0);
    return Object.freeze({
      release() {
        for (const lock of captured) native.releaseFiles(lock);
      },
    });
  } catch {
    throw new Error('INSTALL_FAILED');
  } finally {
    for (const lock of files) native.releaseFiles(lock);
  }
}
