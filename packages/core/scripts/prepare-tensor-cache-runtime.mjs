// Prepare one reviewable unsigned bundle. No publisher/key operation, install,
// launch, existing package replacement, or per-session CUDA copy occurs here.
import { mkdir, copyFile, readFile, writeFile, lstat, readdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, URL } from 'node:url';
import path from 'node:path';
import {
  createDevelopmentRuntimeVerifier,
  packageEvidence,
} from '../out/runtime-package/verifier.js';
import { parseInventory } from '../out/runtime-package/inventory.js';

const refresh = process.argv.length === 3 && process.argv[2] === '--refresh';
const resume = process.argv.length === 3 && process.argv[2] === '--resume';
if (process.argv.length !== 2 && !refresh && !resume)
  throw Error(
    'Use no arguments, --refresh for an unsigned preparation, or --resume for an incomplete one',
  );
const core = fileURLToPath(new URL('../', import.meta.url));
const base = path.join(core, 'out/activation/b11306');
const version = 'b11306-dev12-tensor-cache-v1';
const output = path.join(core, 'out/tensor-cache-native/package-private-directory-v2');
if (!refresh && !resume)
  await mkdir(output); // One fixed staging location, never per-session copies.
else {
  const published = await lstat(path.join(output, 'repository')).then(
    () => true,
    (error) => {
      if (error.code !== 'ENOENT') throw error;
      return false;
    },
  );
  if (published) throw Error('PUBLISHED_PREPARATION_IMMUTABLE');
  if (resume) {
    for (const name of ['preparation.json', 'inventory.json']) {
      await lstat(path.join(output, name)).then(
        () => {
          throw Error('NOT_AN_INCOMPLETE_PREPARATION');
        },
        (error) => {
          if (error.code !== 'ENOENT') throw error;
        },
      );
    }
  } else {
    const prepared = JSON.parse(await readFile(path.join(output, 'preparation.json'), 'utf8'));
    if (prepared.signed !== false || prepared.installed !== false)
      throw Error('NOT_AN_UNSIGNED_PREPARATION');
    const previous = parseInventory(
      JSON.parse(await readFile(path.join(output, 'inventory.json'), 'utf8')),
    );
    if (previous.version !== version) throw Error('NOT_AN_UNSIGNED_PREPARATION');
    for (const file of previous.files) {
      const current = await digest(path.join(output, 'candidate', file.path));
      if (current.length !== file.length || current.sha256 !== file.sha256)
        throw Error('PREPARATION_CHANGED');
    }
  }
}
const verifier = createDevelopmentRuntimeVerifier();
const source = packageEvidence(
  await verifier.verify(path.join(base, 'repository'), path.join(output, 'source-verification')),
).inventory;
const peers = packageEvidence(
  await verifier.verify(
    path.join(base, 'peers/repository'),
    path.join(output, 'peer-source-verification'),
  ),
).inventory;
if (
  source.upstreamCommit !== '4f31296a907d73f3409f720429bcf31111615d77' ||
  peers.upstreamCommit !== source.upstreamCommit ||
  peers.artifact !== source.artifact
)
  throw Error('UNSUPPORTED_RUNTIME');
async function digest(file) {
  const hash = createHash('sha256');
  let length = 0;
  for await (const bytes of createReadStream(file)) {
    hash.update(bytes);
    length += bytes.length;
  }
  return { length, sha256: hash.digest('hex') };
}
const entries = [
  ...source.files
    .filter((file) => !['ModelLoom-peer-host.exe', 'ggml-rpc-server.exe'].includes(file.path))
    .map((file) => ({ ...file, source: path.join(base, 'candidate', file.path) })),
];
const rpc = peers.files.find((file) => file.path === 'ggml-rpc-server.exe');
if (!rpc) throw Error('RPC_PACKAGE_REQUIRED');
entries.push({ ...rpc, source: path.join(base, 'peers/candidate', rpc.path) });
const helper = path.join(core, 'out/peer-host/ModelLoom-peer-host.exe');
entries.push({ path: 'ModelLoom-peer-host.exe', ...(await digest(helper)), source: helper });
const candidate = path.join(output, 'candidate');
await mkdir(candidate, { recursive: refresh || resume });
if ((await lstat(output)).isSymbolicLink() || (await lstat(candidate)).isSymbolicLink())
  throw Error('INVALID_PREPARATION_DIRECTORY');
if (
  resume &&
  (await readdir(candidate)).some((name) => !entries.some((entry) => entry.path === name))
)
  throw Error('PREPARATION_CHANGED');
const files = [];
for (const entry of entries) {
  const original = await digest(entry.source);
  if (original.length !== entry.length || original.sha256 !== entry.sha256)
    throw Error('FILE_MISMATCH');
  const input =
    entry.path === 'ggml-rpc.dll'
      ? path.join(core, 'out/tensor-cache-native/ggml-rpc.dll')
      : entry.source;
  const destination = path.join(candidate, entry.path);
  const wanted = await digest(input);
  if (refresh || resume) {
    const metadata = await lstat(destination);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1)
      throw Error('PREPARATION_CHANGED');
  }
  const present = refresh || resume ? await digest(destination) : undefined;
  if (resume && (present.length !== wanted.length || present.sha256 !== wanted.sha256))
    throw Error('PREPARATION_CHANGED');
  if (!present || present.length !== wanted.length || present.sha256 !== wanted.sha256)
    await copyFile(input, destination);
  files.push({ path: entry.path, ...(await digest(destination)) });
}
const inventory = parseInventory({ ...source, version, files });
await writeFile(path.join(output, 'inventory.json'), JSON.stringify(inventory, null, 2) + '\n', {
  flag: refresh ? 'w' : 'wx',
});
await writeFile(
  path.join(output, 'preparation.json'),
  JSON.stringify(
    {
      sourceVersion: source.version,
      peerSourceVersion: peers.version,
      rpcProtocol: 8,
      sourceArchiveSha256: 'acbc1be00cc17559164f635af6d69df4798b64c2f6504fc90da58cf4f3b80f3b',
      signed: false,
      installed: false,
      files: files.length,
      bytes: files.reduce((sum, file) => sum + file.length, 0),
    },
    null,
    2,
  ) + '\n',
  { flag: refresh ? 'w' : 'wx' },
);
// Public metadata is retained only as provenance. It does not authorize this new inventory.
await writeFile(
  path.join(output, 'source-inventory.json'),
  await readFile(path.join(base, 'repository/inventory.json')),
  { flag: refresh ? 'w' : 'wx' },
);
console.log(
  JSON.stringify({
    prepared: output,
    version: inventory.version,
    files: files.length,
    signed: false,
    installed: false,
  }),
);
