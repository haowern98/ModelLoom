import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { link, lstat, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { METADATA_LIMIT, parseInventory } from '../out/runtime-package/inventory.js';

const [bundle, output] = process.argv.slice(2);
if (process.platform !== 'win32' || !bundle || !output || process.argv.length !== 4)
  throw new Error('Use release-archive.mjs <Windows bundle directory> <existing output directory>');
const root = await realpath(bundle);
const repository = path.join(root, 'repository');
if (path.relative(repository, await realpath(repository)))
  throw new Error('INVALID_RELEASE_METADATA');
const metadata = await readdir(repository);
for (const required of ['root.json', 'timestamp.json', 'inventory.json']) {
  if (!metadata.includes(required)) throw new Error('MISSING_RELEASE_METADATA');
}
for (const role of ['snapshot', 'targets']) {
  if (!metadata.some((name) => new RegExp(`^[1-9][0-9]*\\.${role}\\.json$`, 'u').test(name)))
    throw new Error('MISSING_RELEASE_METADATA');
}
for (const name of metadata) {
  const stat = await lstat(path.join(repository, name));
  if (
    !/^(?:(?:[1-9][0-9]*\.)?(?:root|snapshot|targets)|timestamp|inventory)\.json$/u.test(name) ||
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.size < 1 ||
    stat.size > METADATA_LIMIT
  )
    throw new Error('INVALID_RELEASE_METADATA');
}
const inventory = parseInventory(
  JSON.parse(await readFile(path.join(repository, 'inventory.json'), 'utf8')),
);
if (inventory.backend !== 'cuda' && inventory.backend !== 'vulkan')
  throw new Error('UNSUPPORTED_RELEASE_BACKEND');
if (metadata.length + inventory.files.length > 320) throw new Error('TOO_MANY_RELEASE_FILES');
for (const file of inventory.files) {
  const source = path.join(root, 'candidate', file.path);
  const stat = await lstat(source);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.size !== file.length ||
    path.relative(source, await realpath(source))
  )
    throw new Error(`RELEASE_FILE_MISMATCH: ${file.path}`);
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(source)) digest.update(chunk);
  if (digest.digest('hex') !== file.sha256) throw new Error(`RELEASE_FILE_MISMATCH: ${file.path}`);
}

const directory = await realpath(output);
const work = await mkdtemp(path.join(directory, '.runtime-archive-'));
const filename = `runtime-b11306-${inventory.backend}.zip`;
try {
  const archive = path.join(work, filename);
  const entries = [
    ...metadata.map((name) => `repository/${name}`),
    ...inventory.files.map((file) => `candidate/${file.path}`),
  ];
  const entryList = path.join(work, 'entries.txt');
  await writeFile(entryList, entries.join('\n') + '\n', { flag: 'wx' });
  execFileSync(
    path.join(process.env.SystemRoot, 'System32', 'tar.exe'),
    ['-a', '-cf', archive, '-C', root, '-T', entryList],
    { windowsHide: true, stdio: 'inherit' },
  );
  await link(archive, path.join(directory, filename));
  console.log(path.join(directory, filename));
} finally {
  await rm(work, { recursive: true, force: true });
}
