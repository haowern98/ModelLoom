import { createRequire } from 'node:module';
import { fileURLToPath, URL } from 'node:url';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
const { build } = require('esbuild');
const output = path.join(root, 'out/peer-acceptance');
await mkdir(output, { recursive: true });
await build({
  entryPoints: [path.join(root, 'scripts/peer-worker-probe.mjs')],
  outfile: path.join(output, 'worker.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
});
await build({
  entryPoints: [path.join(root, 'scripts/probe-peer-cuda-start.mjs')],
  outfile: path.join(output, 'start-cuda.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
});
await build({
  entryPoints: [path.join(root, 'scripts/probe-verified-peer.mjs')],
  outfile: path.join(output, 'start-verified.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  banner: {
    js: "import { createRequire as makeRequire } from 'node:module'; const require = makeRequire(import.meta.url);",
  },
});
await writeFile(
  path.join(output, 'package.json'),
  JSON.stringify({ type: 'module', private: true }),
);
const files = [
  path.join(output, 'worker.mjs'),
  path.join(output, 'start-cuda.mjs'),
  path.join(root, 'out/native/ownership.node'),
  path.join(root, 'out/native/peer-identity.node'),
  path.join(root, 'out/tooling/node-v24.21.0-win-x64/node.exe'),
];
const hashes = [];
for (const file of files) {
  const bytes = await readFile(file);
  hashes.push({
    file: path.basename(file),
    length: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
}
await writeFile(path.join(output, 'manifest.json'), JSON.stringify(hashes, null, 2));
console.log(JSON.stringify({ output, files: hashes }));
