// Build the shared cache tests/binding without rebuilding or copying CUDA assets.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { Buffer } from 'node:buffer';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'out/tensor-cache-native');
mkdirSync(output, { recursive: true });
const binary = path.join(root, 'out/native/tensor-cache.node');
const receiptFile = path.join(output, 'build.json');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sourceHash = digest(
  Buffer.concat(
    [
      'scripts/build-tensor-cache.mjs',
      'native/tensor-cache.cc',
      'native/tensor-cache.h',
      'native/tensor-cache-directory.h',
      'native/tensor-cache-policy.h',
      'native/hash/sha256.c',
      'native/hash/sha256.h',
      'native/hash/rotate-bits/rotate-bits.h',
    ].map((file) => readFileSync(path.join(root, file))),
  ),
);
const writeReceipt = () =>
  writeFileSync(
    receiptFile,
    JSON.stringify({
      sourceHash,
      binaryHash: digest(readFileSync(binary)),
      platform: process.platform,
      arch: process.arch,
    }),
  );
if (!process.argv.includes('--test') && existsSync(receiptFile) && existsSync(binary)) {
  try {
    const receipt = JSON.parse(readFileSync(receiptFile, 'utf8'));
    if (
      receipt.sourceHash === sourceHash &&
      receipt.binaryHash === digest(readFileSync(binary)) &&
      receipt.platform === process.platform &&
      receipt.arch === process.arch
    )
      process.exit(0);
  } catch {
    /* Rebuild invalid/stale generated output, never adopt it as authority. */
  }
}
if (process.platform !== 'win32') {
  // N-API is stable across the supported Node/Electron hosts. Use the supplied
  // SDK or an existing local header installation; never download an SDK here.
  const headers = [
    process.env.NODE_INCLUDE_DIR,
    path.resolve(path.dirname(process.execPath), '../include/node'),
    path.join(os.homedir(), '.cache/node-gyp', process.versions.node, 'include/node'),
    '/usr/include/node',
    '/usr/local/include/node',
  ].find((folder) => folder && existsSync(path.join(folder, 'node_api.h')));
  if (!headers) throw Error('NODE_HEADERS_REQUIRED: set NODE_INCLUDE_DIR');
  const flags = ['-std=c++17', '-O2', '-fPIC', '-Wall', '-Wextra', '-Werror'];
  const hash = path.join(output, 'sha256.o');
  execFileSync(
    'cc',
    [
      '-O2',
      '-fPIC',
      '-I',
      path.join(root, 'native/hash'),
      '-c',
      path.join(root, 'native/hash/sha256.c'),
      '-o',
      hash,
    ],
    { cwd: output, stdio: 'inherit' },
  );
  const test = path.join(output, 'tensor-cache-test');
  execFileSync(
    'c++',
    [...flags, path.join(root, 'tests/native/tensor-cache-test.cc'), hash, '-o', test],
    { cwd: output, stdio: 'inherit' },
  );
  mkdirSync(path.join(root, 'out/native'), { recursive: true });
  execFileSync(
    'c++',
    [
      ...flags,
      '-I',
      headers,
      ...(process.platform === 'darwin'
        ? ['-bundle', '-undefined', 'dynamic_lookup']
        : ['-shared']),
      path.join(root, 'native/tensor-cache.cc'),
      hash,
      '-o',
      path.join(root, 'out/native/tensor-cache.node'),
    ],
    { cwd: output, stdio: 'inherit' },
  );
  if (process.argv.includes('--test')) {
    const folder = mkdtempSync(path.join(output, 'test-'));
    try {
      execFileSync(test, [folder], { cwd: output, stdio: 'inherit' });
    } finally {
      if (path.dirname(folder) === output) rmSync(folder, { recursive: true, force: true });
    }
  }
  writeReceipt();
  process.exit(0);
}
const environment = readFileSync(path.join(root, 'out/native/compiler-environment.cmd'), 'utf8');
if (!environment.includes('vcvars64.bat')) throw Error('PINNED_COMPILER_REQUIRED');
const lines = execFileSync(
  'cmd.exe',
  ['/d', '/c', path.join(root, 'out/native/compiler-environment.cmd')],
  { encoding: 'utf8' },
);
const env = Object.fromEntries(
  lines.split(/\r?\n/u).flatMap((line) => {
    const at = line.indexOf('=');
    return at > 0 ? [[line.slice(0, at), line.slice(at + 1)]] : [];
  }),
);
env.TEMP = output;
env.TMP = output;
const common = ['/nologo', '/std:c++17', '/EHsc', '/W4', '/WX', '/utf-8', '/MT', '/O2'];
execFileSync(
  'cl.exe',
  [
    ...common,
    `/I${path.join(root, 'native/hash')}`,
    '/c',
    path.join(root, 'native/hash/sha256.c'),
    `/Fo${path.join(output, 'sha256.obj')}`,
  ],
  { env, cwd: output, stdio: 'inherit' },
);
execFileSync(
  'cl.exe',
  [
    ...common,
    path.join(root, 'tests/native/tensor-cache-test.cc'),
    path.join(output, 'sha256.obj'),
    `/Fe${path.join(output, 'tensor-cache-test.exe')}`,
    '/link',
    'advapi32.lib',
  ],
  { env, cwd: output, stdio: 'inherit' },
);
if (process.argv.includes('--test')) {
  const folder = mkdtempSync(path.join(output, 'test-'));
  try {
    execFileSync(path.join(output, 'tensor-cache-test.exe'), [folder], {
      env,
      cwd: output,
      stdio: 'inherit',
    });
  } finally {
    if (path.dirname(folder) === output) rmSync(folder, { recursive: true, force: true });
  }
}
if (existsSync(path.join(root, 'native/tensor-cache.cc'))) {
  const headers = path.join(process.env.LOCALAPPDATA, 'node-gyp/Cache/24.7.0');
  execFileSync(
    'cl.exe',
    [
      ...common,
      '/LD',
      `/I${path.join(headers, 'include/node')}`,
      path.join(root, 'native/tensor-cache.cc'),
      path.join(output, 'sha256.obj'),
      '/link',
      path.join(root, 'out/native/delay-hook.obj'),
      path.join(headers, 'x64/node.lib'),
      'delayimp.lib',
      'advapi32.lib',
      '/DELAYLOAD:node.exe',
      `/OUT:${path.join(root, 'out/native/tensor-cache.node')}`,
    ],
    { env, cwd: output, stdio: 'inherit' },
  );
}
writeReceipt();
