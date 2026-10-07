import { canonicalize } from '@tufjs/canonical-json';
import {
  Key,
  Metadata,
  MetadataKind,
  Root,
  Signature,
  Targets,
  Snapshot,
  Timestamp,
  MetaFile,
  TargetFile,
} from '@tufjs/models';
import { createHash, createPrivateKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { lstat, readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { ownershipBinding } from '../hosts/windows-ownership.js';
import { parseInventory, METADATA_LIMIT } from '../runtime-package/inventory.js';

export interface CustodyReceipt {
  readonly keyIds: readonly string[];
  readonly rootSha256: string;
}
/** Initial development publication only. Refuse reuse so metadata versions cannot silently roll back. */
export async function publishDevelopmentMetadata(
  directory: string,
  input: unknown,
  repository: string,
): Promise<void> {
  const inventory = parseInventory(input);
  const bytes = Buffer.from(JSON.stringify(inventory));
  if (bytes.length > METADATA_LIMIT) throw new Error('INVALID_INVENTORY');
  await checkCustody(directory);
  const rootBytes = await bounded(path.join(directory, 'public-root.json'));
  const root = Metadata.fromJSON(
    MetadataKind.Root,
    JSON.parse(rootBytes.toString('utf8')) as Parameters<typeof Root.fromJSON>[0],
  );
  repository = path.resolve(repository);
  ownershipBinding().privateDirectory(repository);
  if ((await readdir(repository)).length) throw new Error('REPOSITORY_ALREADY_EXISTS');
  const expires = (days: number) => new Date(Date.now() + days * 86400000).toISOString();
  const signedBytes = async (
    metadata: Metadata<Targets | Snapshot | Timestamp>,
  ): Promise<Buffer> => {
    const role = metadata.signed.type;
    const id = root.signed.roles[role]!.keyIDs[0]!;
    const secret = protectDevelopmentKey(
      'unprotect',
      await bounded(path.join(directory, `${id}.dpapi`)),
    );
    try {
      const key = createPrivateKey({ key: secret, type: 'pkcs8', format: 'der' });
      metadata.sign(
        (data) => new Signature({ keyID: id, sig: sign(null, data, key).toString('hex') }),
      );
      root.verifyDelegate(role, metadata);
      return Buffer.from(JSON.stringify(metadata.toJSON()));
    } finally {
      secret.fill(0);
    }
  };
  const targets = await signedBytes(
    new Metadata(
      new Targets({
        specVersion: '1.0.31',
        version: 1,
        expires: expires(7),
        targets: {
          'inventory.json': new TargetFile({
            path: 'inventory.json',
            length: bytes.length,
            hashes: { sha256: digest(bytes) },
          }),
        },
      }),
    ),
  );
  const meta = (data: Buffer) =>
    new MetaFile({ version: 1, length: data.length, hashes: { sha256: digest(data) } });
  const snapshot = await signedBytes(
    new Metadata(
      new Snapshot({
        specVersion: '1.0.31',
        version: 1,
        expires: expires(2),
        meta: { 'targets.json': meta(targets) },
      }),
    ),
  );
  const timestamp = await signedBytes(
    new Metadata(
      new Timestamp({
        specVersion: '1.0.31',
        version: 1,
        expires: expires(1),
        snapshotMeta: meta(snapshot),
      }),
    ),
  );
  for (const [name, data] of Object.entries({
    'root.json': rootBytes,
    'inventory.json': bytes,
    'targets.json': targets,
    'snapshot.json': snapshot,
    'timestamp.json': timestamp,
  }))
    await writeFile(path.join(repository, name), data, { flag: 'wx' });
}
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
/** Separate publisher operation. DPAPI plaintext uses captured pipes, never arguments,
 * files or diagnostics. This is single-account development custody, not offline custody.
 */
export function protectDevelopmentKey(operation: 'protect' | 'unprotect', bytes: Buffer): Buffer {
  if (!bytes.length || bytes.length > 16384) throw new Error('INVALID_CUSTODY');
  const system = ownershipBinding().systemDirectory();
  const result = spawnSync(
    path.join(system, 'WindowsPowerShell/v1.0/powershell.exe'),
    [
      '-NoProfile',
      '-NonInteractive',
      '-File',
      fileURLToPath(new URL('../../scripts/development-dpapi.ps1', import.meta.url)),
      operation,
    ],
    {
      input: bytes.toString('base64'),
      windowsHide: true,
      timeout: 10000,
      maxBuffer: 65536,
      env: { SystemRoot: path.dirname(system), PATH: system, TEMP: os.tmpdir(), TMP: os.tmpdir() },
    },
  );
  if (
    result.error ||
    result.status !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/u.test(result.stdout.toString('ascii'))
  )
    throw new Error('INVALID_CUSTODY');
  const decoded = Buffer.from(result.stdout.toString('ascii'), 'base64');
  result.stdout.fill(0);
  if (!decoded.length || decoded.length > 16384) throw new Error('INVALID_CUSTODY');
  return decoded;
}
async function bounded(file: string): Promise<Buffer> {
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536)
    throw new Error('INVALID_CUSTODY');
  const bytes = await readFile(file);
  if (bytes.length > 65536) throw new Error('INVALID_CUSTODY');
  return bytes;
}
/** Explicit initialization only. An existing or partial store is never silently rekeyed. */
export async function initializeCustody(directory: string): Promise<CustodyReceipt> {
  directory = path.resolve(directory);
  ownershipBinding().privateDirectory(directory);
  if ((await readdir(directory)).length) throw new Error('CUSTODY_ALREADY_EXISTS');
  const pairs = Array.from({ length: 6 }, () => generateKeyPairSync('ed25519'));
  const publicKeys = pairs.map(({ publicKey }) => {
    const value = {
      keytype: 'ed25519',
      scheme: 'ed25519',
      keyval: {
        public: publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('hex'),
      },
    };
    return Key.fromJSON(digest(Buffer.from(canonicalize(value))), value);
  });
  const ids = publicKeys.map((key) => key.keyID);
  const root = Root.fromJSON({
    _type: 'root',
    spec_version: '1.0.31',
    version: 1,
    expires: new Date(Date.now() + 90 * 86400000).toISOString(),
    consistent_snapshot: false,
    keys: Object.fromEntries(publicKeys.map((key) => [key.keyID, key.toJSON()])),
    roles: {
      root: { keyids: ids.slice(0, 3), threshold: 2 },
      targets: { keyids: [ids[3]!], threshold: 1 },
      snapshot: { keyids: [ids[4]!], threshold: 1 },
      timestamp: { keyids: [ids[5]!], threshold: 1 },
    },
    development_only: true,
  });
  for (let i = 0; i < pairs.length; i++) {
    const bytes = pairs[i]!.privateKey.export({ type: 'pkcs8', format: 'der' });
    try {
      await writeFile(
        path.join(directory, `${ids[i]}.dpapi`),
        protectDevelopmentKey('protect', bytes),
        { flag: 'wx', mode: 0o600 },
      );
    } finally {
      bytes.fill(0);
    }
  }
  const metadata = new Metadata(root);
  for (let i = 0; i < 2; i++)
    metadata.sign(
      (data) =>
        new Signature({
          keyID: ids[i]!,
          sig: sign(null, data, pairs[i]!.privateKey).toString('hex'),
        }),
      true,
    );
  metadata.verifyDelegate('root', metadata);
  const bytes = Buffer.from(JSON.stringify(metadata.toJSON()));
  await writeFile(path.join(directory, 'public-root.json'), bytes, { flag: 'wx', mode: 0o600 });
  return Object.freeze({ keyIds: Object.freeze(ids), rootSha256: digest(bytes) });
}
/** Validate DPAPI integrity and key identity using a challenge, returning public information only. */
export async function checkCustody(directory: string): Promise<CustodyReceipt> {
  try {
    directory = path.resolve(directory);
    ownershipBinding().privateDirectory(directory);
    const bytes = await bounded(path.join(directory, 'public-root.json'));
    const value: unknown = JSON.parse(bytes.toString('utf8'));
    // The bounded public JSON is decoded and structurally validated by the pinned TUF model.
    const metadata = Metadata.fromJSON(
      MetadataKind.Root,
      value as Parameters<typeof Root.fromJSON>[0],
    );
    metadata.verifyDelegate('root', metadata);
    const roles = metadata.signed.roles;
    if (
      metadata.signed.unrecognizedFields?.development_only !== true ||
      roles.root?.threshold !== 2 ||
      roles.root.keyIDs.length !== 3 ||
      ['targets', 'snapshot', 'timestamp'].some(
        (role) => roles[role]?.threshold !== 1 || roles[role]?.keyIDs.length !== 1,
      )
    )
      throw new Error('INVALID_CUSTODY');
    const ids = [
      ...roles.root.keyIDs,
      ...roles.targets!.keyIDs,
      ...roles.snapshot!.keyIDs,
      ...roles.timestamp!.keyIDs,
    ];
    if (new Set(ids).size !== 6 || metadata.signed.isExpired()) throw new Error('INVALID_CUSTODY');
    for (const id of ids) {
      const key = metadata.signed.keys[id];
      if (
        !/^[a-f0-9]{64}$/u.test(id) ||
        !key ||
        key.keyType !== 'ed25519' ||
        key.scheme !== 'ed25519' ||
        !/^[a-f0-9]{64}$/u.test(key.keyVal.public ?? '') ||
        digest(Buffer.from(canonicalize(key.toJSON()))) !== id
      )
        throw new Error('INVALID_CUSTODY');
      const secret = protectDevelopmentKey(
        'unprotect',
        await bounded(path.join(directory, `${id}.dpapi`)),
      );
      try {
        const privateKey = createPrivateKey({ key: secret, type: 'pkcs8', format: 'der' });
        const spki = Buffer.concat([
          Buffer.from('302a300506032b6570032100', 'hex'),
          Buffer.from(key.keyVal.public!, 'hex'),
        ]);
        const challenge = Buffer.from('ModelLoom development key identity');
        if (
          !verify(
            null,
            challenge,
            { key: spki, type: 'spki', format: 'der' },
            sign(null, challenge, privateKey),
          )
        )
          throw new Error('INVALID_CUSTODY');
      } finally {
        secret.fill(0);
      }
    }
    return Object.freeze({ keyIds: Object.freeze(ids), rootSha256: digest(bytes) });
  } catch {
    throw new Error('INVALID_CUSTODY');
  }
}
