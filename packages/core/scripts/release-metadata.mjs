import { createHash, createPrivateKey, sign } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { publishReleaseMetadata } from '../out/publisher/release-metadata.js';
import { protectDevelopmentKey } from '../out/publisher/development-custody.js';

const [planFile, output] = process.argv.slice(2);
if (!planFile || !output || process.argv.length !== 4)
  throw new Error('Use release-metadata.mjs <publication-plan.json> <new-output-directory>');

// The plan lives in publisher custody. Only the generated public files are distributed.
const plan = JSON.parse(await readFile(planFile, 'utf8'));
const { root, keys, versions, expires, mode } = plan;
if (mode !== 'catalog' && mode !== 'package') throw new Error('INVALID_PUBLICATION_MODE');
const names =
  mode === 'catalog'
    ? ['runtime-b11306-cuda.zip', 'runtime-b11306-vulkan.zip']
    : ['inventory.json'];
if (!plan.targets || Object.keys(plan.targets).length !== names.length)
  throw new Error('INVALID_RELEASE_TARGETS');

const targets = {};
for (const name of names) {
  const source = plan.targets[name];
  const details = await stat(source);
  if (!details.isFile()) throw new Error('INVALID_RELEASE_TARGET');
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(source)) digest.update(chunk);
  targets[name] = { length: details.size, sha256: digest.digest('hex') };
}

const rootBytes = await readFile(root);
const roles = ['targets', 'snapshot', 'timestamp'];
const metadata = await publishReleaseMetadata({
  root: rootBytes,
  targets,
  versions,
  expires: Object.fromEntries(roles.map((role) => [role, new Date(expires[role])])),
  sign: async (role, _keyID, bytes) => {
    const source = keys[role];
    const protectedKey = source.endsWith('.dpapi');
    const encoded = await readFile(source);
    const secret = protectedKey ? protectDevelopmentKey('unprotect', encoded) : encoded;
    try {
      const key = createPrivateKey(
        protectedKey ? { key: secret, type: 'pkcs8', format: 'der' } : secret,
      );
      if (key.asymmetricKeyType !== 'ed25519') throw new Error('ED25519_KEY_REQUIRED');
      return sign(null, bytes, key);
    } finally {
      secret.fill(0);
    }
  },
});

await mkdir(output);
const metadataDirectory = path.join(output, mode === 'catalog' ? 'metadata' : 'repository');
await mkdir(metadataDirectory);
await writeFile(path.join(metadataDirectory, 'root.json'), rootBytes, { flag: 'wx' });
await Promise.all(
  Object.entries(metadata).map(([name, bytes]) =>
    writeFile(path.join(metadataDirectory, name), bytes, { flag: 'wx' }),
  ),
);
const targetDirectory = mode === 'catalog' ? path.join(output, 'targets') : metadataDirectory;
if (mode === 'catalog') await mkdir(targetDirectory);
for (const name of names) {
  const filename = mode === 'catalog' ? `${targets[name].sha256}.${name}` : name;
  await copyFile(plan.targets[name], path.join(targetDirectory, filename), constants.COPYFILE_EXCL);
}
