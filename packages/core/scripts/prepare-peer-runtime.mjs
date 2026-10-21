// Build-only: prepare a NEW expanded development package. Does not sign metadata,
// install a runtime, launch native work, or change the existing signed package.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import {
  createDevelopmentRuntimeVerifier,
  packageEvidence,
} from '../out/runtime-package/verifier.js';
import { parseInventory } from '../out/runtime-package/inventory.js';
import { ownershipBinding } from '../out/hosts/windows-ownership.js';

if (process.argv.length !== 2) throw Error('This build tool accepts no arguments');
const root = fileURLToPath(new URL('../', import.meta.url));
const base = path.join(root, 'out/activation/b11306');
const output = path.join(base, 'peers');
await mkdir(output); // Never replace a prior package or publisher result.
const verified = await createDevelopmentRuntimeVerifier().verify(
  path.join(base, 'repository'),
  path.join(output, 'source-verification'),
);
const inventory = packageEvidence(verified).inventory;
if (
  inventory.artifact !== 'b11306-cuda12.4-msvc14.44-dev1' ||
  inventory.upstreamCommit !== '4f31296a907d73f3409f720429bcf31111615d77'
)
  throw Error('UNSUPPORTED_RUNTIME');
const sources = [
  ...inventory.files.map((file) => ({ ...file, source: path.join(base, 'candidate', file.path) })),
  {
    path: 'ggml-rpc-server.exe',
    source: path.join(base, 'evidence/stock-rpc-parity-20261018/ggml-rpc-server.exe'),
    sha256: 'f530f12b421e5966fe04fccf7def04441b796d34480a83f0f59f60061d1d4e09',
    length: 117248,
  },
  {
    path: 'ModelLoom-peer-host.exe',
    source: path.join(root, 'out/peer-host/ModelLoom-peer-host.exe'),
  },
];
const native = ownershipBinding();
const held = native.sealFiles(sources.map((file) => file.source));
try {
  const candidate = path.join(output, 'candidate');
  await mkdir(candidate);
  const files = [];
  for (const file of sources) {
    const destination = path.join(candidate, file.path);
    await copyFile(file.source, destination);
    const digest = createHash('sha256');
    let length = 0;
    for await (const bytes of createReadStream(destination)) {
      digest.update(bytes);
      length += bytes.length;
    }
    const sha256 = digest.digest('hex');
    if ((file.sha256 && sha256 !== file.sha256) || (file.length && length !== file.length))
      throw Error('FILE_MISMATCH');
    files.push({ path: file.path, length, sha256 });
  }
  // Coordinator bytes and numerical artifact remain unchanged. The new version
  // adds the stock worker and its separately reviewed containment helper.
  const next = parseInventory({ ...inventory, version: 'b11306-dev7-peer', files });
  await writeFile(path.join(output, 'inventory.json'), JSON.stringify(next, null, 2) + '\n', {
    flag: 'wx',
  });
  console.log(
    JSON.stringify({
      prepared: output,
      files: files.length,
      signed: false,
      nativeActivated: false,
    }),
  );
} finally {
  native.releaseFiles(held);
}
