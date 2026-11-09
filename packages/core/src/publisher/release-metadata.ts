import { createHash } from 'node:crypto';
import { canonicalize } from '@tufjs/canonical-json';
import {
  MetaFile,
  Metadata,
  MetadataKind,
  Signature,
  Snapshot,
  TargetFile,
  Targets,
  Timestamp,
} from '@tufjs/models';

type Role = 'targets' | 'snapshot' | 'timestamp';
type Target = { length: number; sha256: string };
type MetadataOptions = {
  root: Buffer;
  targets: Readonly<Record<string, Target>>;
  versions: Readonly<Record<Role, number>>;
  expires: Readonly<Record<Role, Date>>;
  sign: (role: Role, keyID: string, bytes: Buffer) => Promise<Buffer>;
};

/** Build consistent-snapshot metadata using an external signer for each delegated role. */
export async function publishReleaseMetadata(
  options: MetadataOptions,
): Promise<Readonly<Record<string, Buffer>>> {
  const root = Metadata.fromJSON(
    MetadataKind.Root,
    JSON.parse(options.root.toString('utf8')) as Parameters<typeof Metadata.fromJSON>[1],
  );
  root.verifyDelegate('root', root);
  const signedRoot = root.signed;
  const now = new Date();
  if (!signedRoot.consistentSnapshot || signedRoot.isExpired(now))
    throw new Error('INVALID_RELEASE_ROOT');
  const roles = ['targets', 'snapshot', 'timestamp'] as const;
  for (const role of roles) {
    const version = options.versions[role];
    const expires = options.expires[role];
    if (
      !Number.isSafeInteger(version) ||
      version < 1 ||
      !Number.isFinite(+expires) ||
      expires <= now
    )
      throw new Error('INVALID_RELEASE_METADATA');
  }
  if (Object.keys(options.targets).length === 0) throw new Error('MISSING_RELEASE_TARGET');
  const targets = Object.fromEntries(
    Object.entries(options.targets).map(([path, { length, sha256 }]) => {
      if (
        !/^[a-z0-9][a-z0-9.-]*\.(?:zip|json)$/u.test(path) ||
        !Number.isSafeInteger(length) ||
        length < 1 ||
        !/^[a-f0-9]{64}$/u.test(sha256)
      )
        throw new Error('INVALID_RELEASE_TARGET');
      return [path, new TargetFile({ path, length, hashes: { sha256 } })];
    }),
  );

  async function envelope(role: Role, metadata: Metadata<Targets | Snapshot | Timestamp>) {
    const delegation = signedRoot.roles[role];
    if (!delegation || delegation.threshold !== 1 || delegation.keyIDs.length !== 1)
      throw new Error('INVALID_RELEASE_ROLE');
    const keyID = delegation.keyIDs[0]!;
    const bytes = await options.sign(
      role,
      keyID,
      Buffer.from(canonicalize(metadata.signed.toJSON())),
    );
    if (bytes.length !== 64) throw new Error('INVALID_RELEASE_SIGNATURE');
    metadata.signatures[keyID] = new Signature({ keyID, sig: bytes.toString('hex') });
    root.verifyDelegate(role, metadata);
    return Buffer.from(JSON.stringify(metadata.toJSON()));
  }

  const fields = (role: Role) => ({
    specVersion: '1.0.31',
    version: options.versions[role],
    expires: options.expires[role].toISOString(),
  });
  const digest = (role: Role, data: Buffer) =>
    new MetaFile({
      version: options.versions[role],
      length: data.length,
      hashes: { sha256: createHash('sha256').update(data).digest('hex') },
    });
  const targetBytes = await envelope(
    'targets',
    new Metadata(new Targets({ ...fields('targets'), targets })),
  );
  const snapshotBytes = await envelope(
    'snapshot',
    new Metadata(
      new Snapshot({
        ...fields('snapshot'),
        meta: { 'targets.json': digest('targets', targetBytes) },
      }),
    ),
  );
  const timestampBytes = await envelope(
    'timestamp',
    new Metadata(
      new Timestamp({
        ...fields('timestamp'),
        snapshotMeta: digest('snapshot', snapshotBytes),
      }),
    ),
  );
  return {
    [`${options.versions.targets}.targets.json`]: targetBytes,
    [`${options.versions.snapshot}.snapshot.json`]: snapshotBytes,
    'timestamp.json': timestampBytes,
  };
}
