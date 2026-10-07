import { createHash } from 'node:crypto';
import { copyFile, lstat, mkdir, open, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Updater } from 'tuf-js';
import type { Fetcher } from 'tuf-js';
// Exact pinned client exception type: root-rotation 404 is distinct from any verification failure.
import { DownloadHTTPError } from 'tuf-js/dist/error.js';
import { METADATA_LIMIT, parseInventory } from './inventory.js';
import type { Inventory } from './inventory.js';
import { lstatSync, readFileSync } from 'node:fs';
import { APPROVED_RUNTIME_ROOTS } from './trust-policy.js';
import { DEVELOPMENT_BUILD, DEVELOPMENT_ROOT } from './development-policy.js';
import { ownershipBinding } from '../hosts/windows-ownership.js';

export interface VerifiedPackage {
  readonly packageId: string;
}
interface Evidence {
  readonly inventory: Inventory;
  readonly realm: 'fixture' | 'live' | 'development';
  readonly verifiedAt: number;
  readonly expires: number;
}
const capabilities = new WeakMap<object, Evidence>();
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('INVALID_METADATA');
  return value as Record<string, unknown>;
}
/** Bytes are bounded before allocation; symlinks are never accepted as local metadata. */
async function bounded(file: string, maximum = METADATA_LIMIT): Promise<Buffer> {
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximum)
    throw new Error('INVALID_METADATA');
  const handle = await open(file, 'r');
  try {
    const bytes = Buffer.alloc(maximum + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead > maximum) throw new Error('INVALID_METADATA');
    return bytes.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}
function verifier(publicRoot: Buffer, realm: Evidence['realm']) {
  const root = Buffer.from(publicRoot);
  if (root.length > METADATA_LIMIT) throw new Error('INVALID_TRUST_ROOT');
  const fingerprint = createHash('sha256').update(root).digest('hex');
  let busy = false;
  return {
    async verify(repository: string, state: string): Promise<VerifiedPackage> {
      if (busy) throw new Error('PACKAGE_VERIFICATION_FAILED');
      busy = true;
      let work: string | undefined;
      let lock: Awaited<ReturnType<typeof open>> | undefined;
      try {
        if (realm !== 'fixture') ownershipBinding().privateDirectory(path.resolve(state));
        else await mkdir(state, { recursive: true });
        const stateStat = await lstat(state);
        if (!stateStat.isDirectory() || stateStat.isSymbolicLink())
          throw new Error('INVALID_STATE');
        lock = await open(path.join(state, 'verify.lock'), 'wx');
        const clockFile = path.join(state, 'clock.json');
        let previous = 0;
        try {
          const value: unknown = JSON.parse((await bounded(clockFile, 64)).toString('utf8'));
          if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error('INVALID_CLOCK');
          previous = Number(value);
        } catch (error) {
          if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
        }
        if (Date.now() < previous) throw new Error('CLOCK_ROLLBACK');
        const cache = path.join(state, `${realm}-${fingerprint}`);
        await mkdir(cache, { recursive: true });
        if ((await lstat(cache)).isSymbolicLink()) throw new Error('INVALID_STATE');
        work = path.join(
          cache,
          `check-${process.pid}-${createHash('sha256').update(String(process.hrtime.bigint())).digest('hex').slice(0, 16)}`,
        );
        await mkdir(work);
        await writeFile(path.join(work, 'root.json'), root, { flag: 'wx' });
        for (const role of ['timestamp', 'snapshot', 'targets']) {
          try {
            await writeFile(
              path.join(work, `${role}.json`),
              await bounded(path.join(cache, `${role}.json`)),
            );
          } catch (error) {
            if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
              throw error;
          }
        }
        const rotations = new Map<string, Buffer>();
        const fetcher: Fetcher = {
          async downloadBytes(url, maximum) {
            const target = new URL(url);
            if (
              target.origin !== 'https://bootstrap.invalid' ||
              target.search ||
              target.hash ||
              !/^\/[a-z0-9.-]+\.json$/u.test(target.pathname)
            )
              throw new Error('INVALID_METADATA_URL');
            const name = target.pathname.slice(1);
            const rotated = /^[1-9][0-9]*\.root\.json$/u.test(name);
            try {
              let bytes: Buffer;
              try {
                bytes = await bounded(
                  path.join(repository, name),
                  Math.min(maximum, METADATA_LIMIT),
                );
              } catch (error) {
                if (
                  !rotated ||
                  !(error instanceof Error && 'code' in error && error.code === 'ENOENT')
                )
                  throw error;
                bytes = await bounded(path.join(cache, name), Math.min(maximum, METADATA_LIMIT));
              }
              if (rotated) rotations.set(name, bytes);
              return bytes;
            } catch (error) {
              if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
                throw new DownloadHTTPError('LOCAL_METADATA_MISSING', 404);
              throw error;
            }
          },
          downloadFile() {
            return Promise.reject(new Error('DOWNLOAD_DISABLED'));
          },
        };
        const client = new Updater({
          metadataDir: work,
          metadataBaseUrl: 'https://bootstrap.invalid/',
          fetcher,
          config: {
            rootMaxLength: METADATA_LIMIT,
            timestampMaxLength: METADATA_LIMIT,
            snapshotMaxLength: METADATA_LIMIT,
            targetsMaxLength: METADATA_LIMIT,
            maxRootRotations: 32,
            maxDelegations: 0,
            fetchRetry: false,
          },
        });
        await client.refresh();
        const target = await client.getTargetInfo('inventory.json');
        if (!target || target.length > METADATA_LIMIT || !target.hashes.sha256)
          throw new Error('MISSING_INVENTORY');
        const bytes = await bounded(path.join(repository, 'inventory.json'));
        // Verify the exact same captured bytes that are parsed, preventing an inventory replacement race.
        const captured = path.join(work, 'inventory.json');
        await writeFile(captured, bytes, { flag: 'wx' });
        if (!(await client.findCachedTarget(target, captured)))
          throw new Error('TAMPERED_INVENTORY');
        const inventory = parseInventory(JSON.parse(bytes.toString('utf8')));
        let expires = Infinity;
        for (const role of ['root', 'timestamp', 'snapshot', 'targets']) {
          const metadata: unknown = JSON.parse(
            (await bounded(path.join(work, `${role}.json`))).toString('utf8'),
          );
          const expiration = object(object(metadata).signed).expires;
          if (typeof expiration !== 'string') throw new Error('INVALID_EXPIRY');
          const expiry = Date.parse(expiration);
          if (!Number.isFinite(expiry)) throw new Error('INVALID_EXPIRY');
          expires = Math.min(expires, expiry);
        }
        for (const [name, contents] of rotations) await writeFile(path.join(cache, name), contents);
        for (const role of ['timestamp', 'snapshot', 'targets'])
          await copyFile(path.join(work, `${role}.json`), path.join(cache, `${role}.json`));
        const now = Date.now();
        if (now < previous) throw new Error('CLOCK_ROLLBACK');
        await writeFile(`${clockFile}.new`, JSON.stringify(now));
        await rename(`${clockFile}.new`, clockFile);
        const capability = Object.freeze({ packageId: inventory.packageId });
        capabilities.set(capability, Object.freeze({ inventory, realm, verifiedAt: now, expires }));
        return capability;
      } catch {
        throw new Error('PACKAGE_VERIFICATION_FAILED');
      } finally {
        busy = false;
        if (work) await rm(work, { recursive: true, force: true });
        if (lock) {
          await lock.close();
          await rm(path.join(state, 'verify.lock'));
        }
      }
    },
  };
}
/** Development fixture realm cannot be promoted to live authority by callers or serialized receipts. */
export function createFixtureVerifier(root: Buffer) {
  return verifier(root, 'fixture');
}
/** Trusted in-process consumers still need a real, unexpired capability; files are checked separately. */
export function packageEvidence(value: unknown): Readonly<Evidence> {
  const evidence = value && typeof value === 'object' ? capabilities.get(value) : undefined;
  if (!evidence || Date.now() < evidence.verifiedAt || Date.now() >= evidence.expires)
    throw new Error('UNVERIFIED_PACKAGE');
  return evidence;
}
export function requireLivePackage(value: unknown): Readonly<Evidence> {
  const evidence = packageEvidence(value);
  if (evidence.realm !== 'live' && !(evidence.realm === 'development' && DEVELOPMENT_BUILD))
    throw new Error('UNVERIFIED_PACKAGE');
  return evidence;
}
/** Production root provisioning is a reviewed build change, never a runtime argument or bundle file. */
export function createRuntimeVerifier(): ReturnType<typeof verifier> {
  const policy = APPROVED_RUNTIME_ROOTS[0];
  if (!policy || APPROVED_RUNTIME_ROOTS.length !== 1) throw new Error('MISSING_TRUST_ROOT');
  return pinnedVerifier(policy, 'live');
}
/** Requires the explicit development build and its pinned public root, never a caller-selected root. */
export function createDevelopmentRuntimeVerifier(): ReturnType<typeof verifier> {
  if (!DEVELOPMENT_BUILD) throw new Error('DEVELOPMENT_BUILD_REQUIRED');
  return pinnedVerifier(DEVELOPMENT_ROOT, 'development');
}
function pinnedVerifier(
  policy: Readonly<{ asset: string; sha256: string }>,
  realm: 'live' | 'development',
): ReturnType<typeof verifier> {
  if (!/^[a-zA-Z0-9.-]+\.json$/u.test(policy.asset) || !/^[a-f0-9]{64}$/u.test(policy.sha256))
    throw new Error('INVALID_TRUST_ROOT');
  const asset = new URL(`../../assets/${policy.asset}`, import.meta.url);
  const stat = lstatSync(asset);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > METADATA_LIMIT)
    throw new Error('INVALID_TRUST_ROOT');
  const root = readFileSync(asset);
  if (
    root.length > METADATA_LIMIT ||
    createHash('sha256').update(root).digest('hex') !== policy.sha256
  )
    throw new Error('INVALID_TRUST_ROOT');
  const metadata: unknown = JSON.parse(root.toString('utf8'));
  if ((object(object(metadata).signed).development_only === true) !== (realm === 'development'))
    throw new Error('INVALID_TRUST_ROOT');
  const roles = object(object(object(metadata).signed).roles);
  const role = object(roles.root);
  const targets = object(roles.targets);
  const rootKeys = role.keyids,
    targetKeys = targets.keyids;
  if (
    role.threshold !== 2 ||
    !Array.isArray(rootKeys) ||
    rootKeys.length !== 3 ||
    rootKeys.some((key: unknown) => typeof key !== 'string') ||
    new Set<unknown>(rootKeys).size !== 3 ||
    !Array.isArray(targetKeys) ||
    targetKeys.length === 0 ||
    targetKeys.some((key: unknown) => typeof key !== 'string' || rootKeys.includes(key))
  )
    throw new Error('INVALID_TRUST_ROOT');
  return verifier(root, realm);
}
