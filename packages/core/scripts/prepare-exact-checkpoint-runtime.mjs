// Prepare a separately reviewable unsigned coordinator. No signing/install or
// trust changes; the peer runtime and all math/kernel files remain unchanged.
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';
import path from 'node:path';
import {
  createDevelopmentRuntimeVerifier,
  requireLivePackage,
} from '../out/runtime-package/verifier.js';
import { parseInventory } from '../out/runtime-package/inventory.js';
import { ownershipBinding } from '../out/hosts/windows-ownership.js';

if (process.argv.length !== 2) throw Error('Unsigned preparation accepts no arguments');
const core = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(core, 'out/activation/b11306-exact-checkpoints');
await mkdir(output);
const previous = requireLivePackage(
  await createDevelopmentRuntimeVerifier().verify(
    path.join(core, 'out/activation/b11306/repository'),
    path.join(output, 'source-verification'),
  ),
).inventory;
if (
  previous.upstreamCommit !== '4f31296a907d73f3409f720429bcf31111615d77' ||
  previous.version !== 'b11306-dev14-speculation-tensor-cache-v1'
)
  throw Error('SOURCE_VERSION_MISMATCH');
const changedFiles = ['llama-common.dll', 'llama-server-impl.dll'];
const files = previous.files.map((file) => ({
  ...file,
  source: path.join(
    core,
    changedFiles.includes(file.path)
      ? 'out/exact-checkpoints/candidate'
      : 'out/activation/b11306/candidate',
    file.path,
  ),
}));
const native = ownershipBinding();
const held = native.sealFiles(files.map((file) => file.source));
try {
  const candidate = path.join(output, 'candidate');
  await mkdir(candidate);
  const next = [];
  for (const file of files) {
    const bytes = await readFile(file.source);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (
      changedFiles.includes(file.path)
        ? sha256 === file.sha256
        : sha256 !== file.sha256 || bytes.length !== file.length
    )
      throw Error('UNEXPECTED_RUNTIME_CHANGE');
    const target = path.join(candidate, file.path);
    await copyFile(file.source, target);
    const copied = await readFile(target);
    if (!copied.equals(bytes)) throw Error('COPY_MISMATCH');
    next.push({ path: file.path, length: bytes.length, sha256 });
  }
  const inventory = parseInventory({
    ...previous,
    version: 'b11306-dev17-exact-checkpoints-tensor-cache-v1',
    files: next,
  });
  await writeFile(path.join(output, 'inventory.json'), JSON.stringify(inventory, null, 2), {
    flag: 'wx',
  });
  const report = {
    sourceVersion: previous.version,
    version: inventory.version,
    changedFiles,
    signed: false,
    installed: false,
    peerRuntimeChanged: false,
  };
  await writeFile(path.join(output, 'preparation.json'), JSON.stringify(report, null, 2), {
    flag: 'wx',
  });
  console.log(JSON.stringify(report));
} finally {
  native.releaseFiles(held);
}
