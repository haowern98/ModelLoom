// Copy only a hash-checked CPU subset for the isolated, loopback-only probe.
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const cuda = process.argv.length === 3 && process.argv[2] === '--cuda';
if (process.platform !== 'win32' || (!cuda && process.argv.length !== 2))
  throw new Error('Windows diagnostic only; only --cuda is accepted');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assets = path.join(root, 'out/activation/b11306');
const inventory = JSON.parse(readFileSync(path.join(assets, 'repository/inventory.json'), 'utf8'));
if (inventory.upstreamCommit !== '4f31296a907d73f3409f720429bcf31111615d77')
  throw new Error('Unexpected diagnostic upstream pin');
const destination = path.join(
  root,
  cuda ? 'out/network-guard-probe/stock-rpc-gpu' : 'out/network-guard-probe/stock-rpc',
);
mkdirSync(destination, { recursive: true });
const names = [
  'ggml.dll',
  'ggml-base.dll',
  'ggml-rpc.dll',
  'ggml-cpu-x64.dll',
  'libomp.dll',
  'msvcp140.dll',
  'vcruntime140.dll',
  'vcruntime140_1.dll',
  ...(cuda ? ['ggml-cuda.dll', 'cublas64_12.dll', 'cublasLt64_12.dll', 'cudart64_12.dll'] : []),
];
const hash = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
let total = 0;
for (const name of [...names, 'ggml-rpc-server.exe']) {
  const rpc = name === 'ggml-rpc-server.exe';
  const entry = rpc
    ? { length: 117248, sha256: 'f530f12b421e5966fe04fccf7def04441b796d34480a83f0f59f60061d1d4e09' }
    : inventory.files.find((file) => file.path === name);
  const source = path.join(assets, rpc ? 'evidence/stock-rpc-parity-20261018' : 'candidate', name);
  if (!entry || statSync(source).size !== entry.length || hash(source) !== entry.sha256)
    throw new Error(`Diagnostic source mismatch: ${name}`);
  const target = path.join(destination, name);
  copyFileSync(source, target);
  if (hash(target) !== entry.sha256) throw new Error(`Diagnostic copy mismatch: ${name}`);
  total += entry.length;
}
console.log(
  `Staged ${total} bytes of hash-checked ${cuda ? 'CUDA' : 'CPU-only'} diagnostic assets; existing runtime unchanged.`,
);
