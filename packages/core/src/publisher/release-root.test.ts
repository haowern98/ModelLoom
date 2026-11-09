import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { Metadata, MetadataKind, Root } from '@tufjs/models';
import { expect, test } from 'vitest';
import { finalizeReleaseRoot, prepareReleaseRoot } from './release-root.js';
import { publishReleaseMetadata } from './release-metadata.js';

function ceremony() {
  const pairs = Array.from({ length: 6 }, () => generateKeyPairSync('ed25519'));
  const publicKeys = pairs.map(({ publicKey }) =>
    publicKey.export({ format: 'pem', type: 'spki' }).toString(),
  );
  const keys = {
    root: publicKeys.slice(0, 3),
    targets: [publicKeys[3]!],
    snapshot: [publicKeys[4]!],
    timestamp: [publicKeys[5]!],
  };
  const expires = new Date('2099-01-01T00:00:00Z');
  const signed = prepareReleaseRoot(keys, expires);
  const root = Root.fromJSON(
    JSON.parse(signed.toString('utf8')) as Parameters<typeof Root.fromJSON>[0],
  );
  const signature = (index: number) =>
    [root.roles.root!.keyIDs[index]!, sign(null, signed, pairs[index]!.privateKey)] as const;
  return { keys, expires, root, signed, signature, pairs };
}

test('any two offline root signers can provision and recover the same trust policy', () => {
  const { root, signed, signature } = ceremony();
  for (const [first, second] of [
    [0, 1],
    [0, 2],
    [1, 2],
  ] as const) {
    const result = finalizeReleaseRoot(signed, new Map([signature(first), signature(second)]));
    const envelope = JSON.parse(result.bytes.toString('utf8')) as Parameters<
      typeof Metadata.fromJSON
    >[1];
    const metadata = Metadata.fromJSON(MetadataKind.Root, envelope);
    metadata.verifyDelegate('root', metadata);
    expect(metadata.signed.toJSON()).toEqual(root.toJSON());
    expect(result.sha256).toBe(createHash('sha256').update(result.bytes).digest('hex'));
  }
});

test('signs catalog targets, snapshot and timestamp with their separate role keys', async () => {
  const { signed, signature, pairs, expires } = ceremony();
  const { bytes: root } = finalizeReleaseRoot(signed, new Map([signature(0), signature(1)]));
  const keyIndexes = { targets: 3, snapshot: 4, timestamp: 5 };
  const options = {
    root,
    targets: { 'runtime-b11306-cuda.zip': { length: 7, sha256: 'a'.repeat(64) } },
    versions: { targets: 3, snapshot: 4, timestamp: 5 },
    expires: { targets: expires, snapshot: expires, timestamp: expires },
  };
  const published = await publishReleaseMetadata({
    ...options,
    sign: (role, _keyID, bytes) =>
      Promise.resolve(sign(null, bytes, pairs[keyIndexes[role]]!.privateKey)),
  });
  expect(Object.keys(published)).toEqual(['3.targets.json', '4.snapshot.json', 'timestamp.json']);
  expect(published['4.snapshot.json']!.toString()).toContain(
    createHash('sha256').update(published['3.targets.json']!).digest('hex'),
  );
  expect(published['timestamp.json']!.toString()).toContain(
    createHash('sha256').update(published['4.snapshot.json']!).digest('hex'),
  );
  await expect(
    publishReleaseMetadata({
      ...options,
      sign: (_role, _keyID, bytes) => Promise.resolve(sign(null, bytes, pairs[0]!.privateKey)),
    }),
  ).rejects.toThrow();
});

test('rejects missing quorum, tampered signatures and reused role keys', () => {
  const { keys, expires, signed, signature } = ceremony();
  expect(() => finalizeReleaseRoot(signed, new Map([signature(0)]))).toThrow(
    'ROOT_QUORUM_REQUIRED',
  );
  const second = signature(1);
  expect(() =>
    finalizeReleaseRoot(signed, new Map([signature(0), [second[0], Buffer.alloc(64)]])),
  ).toThrow();
  expect(() => prepareReleaseRoot({ ...keys, timestamp: keys.targets }, expires)).toThrow(
    'DUPLICATE_ROLE_KEY',
  );
});
