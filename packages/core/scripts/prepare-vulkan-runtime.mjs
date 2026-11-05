// Prepare a separate unsigned package, preserving every existing CUDA package byte.
import { createHash } from 'node:crypto';
import { readFile, copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createDevelopmentRuntimeVerifier,
  requireLivePackage,
} from '../out/runtime-package/verifier.js';
import { parseInventory } from '../out/runtime-package/inventory.js';

const core = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(core, 'out/activation/b11306');
const build = path.join(core, 'out/vulkan-development');
const output = path.join(core, 'out/activation/b11306-vulkan');
const candidate = path.join(output, 'candidate');
await mkdir(output, { recursive: true });
await mkdir(candidate); // Never overwrite an already prepared or signed package.
const inventory = requireLivePackage(
  await createDevelopmentRuntimeVerifier().verify(
    path.join(source, 'repository'),
    path.join(output, 'source-verification'),
  ),
).inventory;
if (inventory.version !== 'b11306-dev14-speculation-tensor-cache-v1')
  throw Error('UNSUPPORTED_RUNTIME');
const excluded = new Set([
  'ggml-cuda.dll',
  'cublas64_12.dll',
  'cublasLt64_12.dll',
  'cudart64_12.dll',
  'ModelLoom-runtime-host.exe',
  'ModelLoom-peer-host.exe',
]);
const files = [];
async function add(name, from, expected) {
  const bytes = await readFile(from);
  const file = {
    path: name,
    length: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
  if (expected && (expected.length !== file.length || expected.sha256 !== file.sha256))
    throw Error('FILE_MISMATCH');
  await copyFile(from, path.join(candidate, name));
  files.push(file);
}
for (const file of inventory.files)
  if (!excluded.has(file.path))
    await add(file.path, path.join(source, 'candidate', file.path), file);
for (const name of ['ModelLoom-runtime-host.exe', 'ModelLoom-peer-host.exe'])
  await add(name, path.join(build, name));
const archive = path.join(
  core,
  'out/b11306-backend-smoke-20261105/llama-b11306-bin-win-vulkan-x64.zip',
);
if (
  createHash('sha256')
    .update(await readFile(archive))
    .digest('hex') !== 'ea52b47ded50e6a835b88a796d0343e577aada3e80e981eba37e7f3a0f6a6a8a'
)
  throw Error('UPSTREAM_MISMATCH');
const vulkanFile = path.join(core, 'out/b11306-backend-smoke-20261105/vulkan/ggml-vulkan.dll');
if (
  createHash('sha256')
    .update(await readFile(vulkanFile))
    .digest('hex') !== 'd0c130e7dc9acf241016ee8424a489290795a96720e292f3cec277bbb335f641'
)
  throw Error('UPSTREAM_MISMATCH');
await add('ggml-vulkan.dll', vulkanFile);
const prepared = parseInventory({
  ...inventory,
  packageId: 'llama-vulkan-development',
  version: 'b11306-dev2-tensor-cache-v1',
  artifact: 'b11306-vulkan-msvc14.44-dev1',
  backend: 'vulkan',
  minimumDriver: '551.78',
  files,
});
await writeFile(path.join(output, 'inventory.json'), JSON.stringify(prepared), { flag: 'wx' });
console.log(
  JSON.stringify({
    output,
    inventorySha256: createHash('sha256').update(JSON.stringify(prepared)).digest('hex'),
    files: files.length,
    rpcProtocol: 8,
    signed: false,
  }),
);
