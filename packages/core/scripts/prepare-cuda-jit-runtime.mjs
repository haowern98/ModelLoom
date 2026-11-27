// Build-only preparation: no signing keys, installation, launch or replacement.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import {
  createDevelopmentRuntimeVerifier,
  requireLivePackage,
} from '../out/runtime-package/verifier.js';
import { parseInventory } from '../out/runtime-package/inventory.js';
import { ownershipBinding } from '../out/hosts/windows-ownership.js';

if (process.argv.length !== 2 || process.platform !== 'win32')
  throw Error('Windows unsigned preparation accepts no arguments');
const core = fileURLToPath(new URL('../', import.meta.url));
const source = path.join(core, 'out/activation/b11306/peers');
const output = path.join(core, 'out/activation/b11306-cuda-jit');
await mkdir(output); // Fail instead of changing any earlier preparation/repository.
const previous = requireLivePackage(
  await createDevelopmentRuntimeVerifier().verify(
    path.join(source, 'repository'),
    path.join(output, 'source-verification'),
  ),
).inventory;
if (
  previous.version !== 'b11306-dev15-readiness-tensor-cache-v1' ||
  previous.upstreamCommit !== '4f31296a907d73f3409f720429bcf31111615d77'
)
  throw Error('UNSUPPORTED_RUNTIME');
const helper = 'ModelLoom-peer-host.exe';
if (!previous.files.some((file) => file.path === helper)) throw Error('HELPER_REQUIRED');
const sources = previous.files.map((file) => ({
  ...file,
  source:
    file.path === helper
      ? path.join(core, 'out/peer-host', helper)
      : path.join(source, 'candidate', file.path),
}));
const native = ownershipBinding();
const held = native.sealFiles(sources.map((file) => file.source));
async function digest(file) {
  const hash = createHash('sha256');
  let length = 0;
  for await (const bytes of createReadStream(file)) {
    hash.update(bytes);
    length += bytes.length;
  }
  return { length, sha256: hash.digest('hex') };
}
try {
  const candidate = path.join(output, 'candidate');
  await mkdir(candidate);
  const files = [];
  for (const file of sources) {
    const current = await digest(file.source);
    if (file.path !== helper && (current.length !== file.length || current.sha256 !== file.sha256))
      throw Error('SOURCE_FILE_MISMATCH');
    if (file.path === helper && current.sha256 === file.sha256)
      throw Error('HELPER_CHANGE_REQUIRED');
    const destination = path.join(candidate, file.path);
    await copyFile(file.source, destination);
    const copied = await digest(destination);
    if (copied.length !== current.length || copied.sha256 !== current.sha256)
      throw Error('COPY_MISMATCH');
    files.push({ path: file.path, ...copied });
  }
  const inventory = parseInventory({
    ...previous,
    version: 'b11306-dev16-cuda-jit-tensor-cache-v1',
    files,
  });
  await writeFile(path.join(output, 'inventory.json'), JSON.stringify(inventory, null, 2) + '\n', {
    flag: 'wx',
  });
  const report = {
    sourceVersion: previous.version,
    version: inventory.version,
    changedFiles: [helper],
    unchangedFiles: files.length - 1,
    signed: false,
    installed: false,
    nativeActivated: false,
  };
  await writeFile(path.join(output, 'preparation.json'), JSON.stringify(report, null, 2) + '\n', {
    flag: 'wx',
  });
  console.log(JSON.stringify(report));
} finally {
  native.releaseFiles(held);
}
