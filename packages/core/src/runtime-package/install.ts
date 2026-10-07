import type { VerifiedPackage } from './verifier.js';
import { packageEvidence, requireLivePackage } from './verifier.js';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, lstat, mkdir, opendir, rm } from 'node:fs/promises';
import path from 'node:path';
import { ownershipBinding } from '../hosts/windows-ownership.js';
import type { Inventory } from './inventory.js';
export interface InstalledPackage {
  readonly packageId: string;
  readonly directory: string;
}
const installedPackages = new WeakMap<object, VerifiedPackage>();
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
  const expected = new Set(inventory.files.map((file) => file.path));
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
  for (const file of inventory.files) {
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
/** Expanded bootstrap only. A fresh private directory preserves every existing installed version. */
export async function installExpanded(
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
    native.privateDirectory(path.resolve(root));
    candidate = path.join(
      path.resolve(root),
      `${inventory.packageId}-${inventory.version}-${randomUUID()}`,
    );
    native.privateDirectory(candidate);
    for (const file of inventory.files) {
      const destination = path.join(candidate, file.path);
      await mkdir(path.dirname(destination), { recursive: true });
      await copyFile(path.join(bundle, file.path), destination);
    }
    const result = Object.freeze({ packageId: inventory.packageId, directory: candidate });
    installedPackages.set(result, capability);
    const lock = await revalidateInstalled(result);
    lock.release();
    candidate = undefined;
    return result;
  } catch {
    if (candidate) await rm(candidate, { recursive: true, force: true });
    throw new Error('INSTALL_FAILED');
  } finally {
    if (source) native.releaseFiles(source);
  }
}
/** Rehash every dependency with native file and ancestor handles retained until the consumer releases. */
export async function revalidateInstalled(
  installed: InstalledPackage,
): Promise<{ release(): void }> {
  const native = ownershipBinding();
  let files: object | undefined;
  try {
    const capability = installedPackages.get(installed);
    if (!capability) throw new Error('UNVERIFIED_PACKAGE');
    const { inventory } = packageEvidence(capability);
    files = native.sealFiles(
      inventory.files.map((file) => path.join(installed.directory, file.path)),
    );
    await inspect(installed.directory, inventory);
    const captured = files;
    files = undefined;
    return Object.freeze({
      release() {
        native.releaseFiles(captured);
      },
    });
  } catch {
    throw new Error('INSTALL_FAILED');
  } finally {
    if (files) native.releaseFiles(files);
  }
}
