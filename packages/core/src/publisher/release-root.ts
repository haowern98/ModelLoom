import { createHash, createPublicKey } from 'node:crypto';
import { canonicalize } from '@tufjs/canonical-json';
import { Key, Metadata, Root, Signature } from '@tufjs/models';

export const releaseRoles = ['root', 'targets', 'snapshot', 'timestamp'] as const;
type Role = (typeof releaseRoles)[number];
type PublicKeys = Readonly<Record<Role, readonly string[]>>;

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

/** Build the canonical bytes for an offline, first-version production trust root. */
export function prepareReleaseRoot(publicKeys: PublicKeys, expires: Date): Buffer {
  if (!Number.isFinite(+expires) || +expires <= Date.now()) throw new Error('INVALID_ROOT_EXPIRY');
  const keys = new Map<string, Key>();
  const roles = Object.fromEntries(
    releaseRoles.map((role) => {
      const threshold = role === 'root' ? 2 : 1;
      const expected = role === 'root' ? 3 : 1;
      if (publicKeys[role].length !== expected) throw new Error('INVALID_ROLE_KEY_COUNT');
      const keyids = publicKeys[role].map((pem) => {
        if (!/^-----BEGIN PUBLIC KEY-----\r?\n/u.test(pem)) throw new Error('PUBLIC_KEY_REQUIRED');
        const key = createPublicKey(pem);
        if (key.asymmetricKeyType !== 'ed25519') throw new Error('ED25519_KEY_REQUIRED');
        const value = {
          keytype: 'ed25519',
          scheme: 'ed25519',
          keyval: {
            public: key.export({ type: 'spki', format: 'der' }).subarray(-32).toString('hex'),
          },
        };
        const id = sha256(Buffer.from(canonicalize(value)));
        if (keys.has(id)) throw new Error('DUPLICATE_ROLE_KEY');
        keys.set(id, Key.fromJSON(id, value));
        return id;
      });
      return [role, { keyids, threshold }];
    }),
  );
  const root = Root.fromJSON({
    _type: 'root',
    spec_version: '1.0.31',
    version: 1,
    expires: expires.toISOString(),
    consistent_snapshot: true,
    keys: Object.fromEntries([...keys].map(([id, key]) => [id, key.toJSON()])),
    roles,
  });
  return Buffer.from(canonicalize(root.toJSON()));
}

/** Attach detached signatures made by distinct offline root keys and verify the quorum. */
export function finalizeReleaseRoot(
  signed: Buffer,
  signatures: ReadonlyMap<string, Buffer>,
): { bytes: Buffer; sha256: string } {
  const root = Root.fromJSON(
    JSON.parse(signed.toString('utf8')) as Parameters<typeof Root.fromJSON>[0],
  );
  if (!signed.equals(Buffer.from(canonicalize(root.toJSON()))))
    throw new Error('NONCANONICAL_ROOT');
  const { keyIDs } = root.roles.root!;
  if (signatures.size < 2) throw new Error('ROOT_QUORUM_REQUIRED');
  const metadata = new Metadata(root);
  for (const [keyID, bytes] of signatures) {
    if (!keyIDs.includes(keyID) || bytes.length !== 64) throw new Error('INVALID_ROOT_SIGNATURE');
    const signature = new Signature({ keyID, sig: bytes.toString('hex') });
    const signedByKey = new Metadata(root, { [keyID]: signature });
    root.keys[keyID]!.verifySignature(signedByKey);
    metadata.signatures[keyID] = signature;
  }
  metadata.verifyDelegate('root', metadata);
  const bytes = Buffer.from(JSON.stringify(metadata.toJSON()));
  return { bytes, sha256: sha256(bytes) };
}
