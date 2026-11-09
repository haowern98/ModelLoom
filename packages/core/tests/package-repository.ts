import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Ephemeral signing keys exist only in tests. This is not publisher key provisioning.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(Reflect.get(value, key))}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
export async function repository(
  directory: string,
  inventory: unknown,
  expires = '2099-01-01T00:00:00Z',
  assets: Readonly<Record<string, Buffer>> = {},
  consistentSnapshot = false,
) {
  await mkdir(directory, { recursive: true });
  const pairs = Array.from({ length: 4 }, () => generateKeyPairSync('ed25519'));
  const keys = pairs.map(({ publicKey }) => ({
    keytype: 'ed25519',
    scheme: 'ed25519',
    keyval: {
      public: publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('hex'),
    },
  }));
  const ids = keys.map((key) => createHash('sha256').update(canonical(key)).digest('hex'));
  const envelope = (signed: unknown, indexes: number[]) =>
    Buffer.from(
      JSON.stringify({
        signed,
        signatures: indexes.map((i) => ({
          keyid: ids[i],
          sig: sign(null, Buffer.from(canonical(signed)), pairs[i]!.privateKey).toString('hex'),
        })),
      }),
    );
  const root = envelope(
    {
      _type: 'root',
      spec_version: '1.0.31',
      version: 1,
      expires,
      consistent_snapshot: consistentSnapshot,
      keys: Object.fromEntries(ids.map((id, i) => [id, keys[i]])),
      roles: {
        root: { keyids: ids.slice(0, 3), threshold: 2 },
        targets: { keyids: [ids[3]], threshold: 1 },
        snapshot: { keyids: [ids[3]], threshold: 1 },
        timestamp: { keyids: [ids[3]], threshold: 1 },
      },
    },
    [0, 1],
  );
  const target = Buffer.from(JSON.stringify(inventory));
  const digest = (bytes: Buffer) => ({
    version: 1,
    length: bytes.length,
    hashes: { sha256: createHash('sha256').update(bytes).digest('hex') },
  });
  const targets = envelope(
    {
      _type: 'targets',
      spec_version: '1.0.31',
      version: 1,
      expires,
      targets: Object.fromEntries(
        Object.entries({ 'inventory.json': target, ...assets }).map(([name, bytes]) => [
          name,
          { length: bytes.length, hashes: digest(bytes).hashes },
        ]),
      ),
    },
    [3],
  );
  const snapshot = envelope(
    {
      _type: 'snapshot',
      spec_version: '1.0.31',
      version: 1,
      expires,
      meta: { 'targets.json': digest(targets) },
    },
    [3],
  );
  const timestamp = envelope(
    {
      _type: 'timestamp',
      spec_version: '1.0.31',
      version: 1,
      expires,
      meta: { 'snapshot.json': digest(snapshot) },
    },
    [3],
  );
  for (const [name, bytes] of Object.entries({
    'root.json': root,
    'targets.json': targets,
    'snapshot.json': snapshot,
    'timestamp.json': timestamp,
    'inventory.json': target,
    ...(consistentSnapshot ? { '1.targets.json': targets, '1.snapshot.json': snapshot } : {}),
  }))
    await writeFile(path.join(directory, name), bytes);
  return { root, target, envelope, digest };
}
