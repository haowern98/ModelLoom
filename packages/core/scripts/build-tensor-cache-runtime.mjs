// Rebuild ONLY the RPC transport DLL against import libraries derived from the
// exact existing DLLs. CUDA kernels, ggml-base and all model math stay untouched.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'out/tensor-cache-native');
const patched = path.join(output, 'runtime-source');
const source = path.join(
  root,
  'out/tensor-cache-source/llama.cpp-4f31296a907d73f3409f720429bcf31111615d77',
);
const candidate = path.join(root, 'out/activation/b11306/candidate');
mkdirSync(output, { recursive: true });
execFileSync(process.execPath, [path.join(root, 'scripts/patch-tensor-cache-runtime.mjs')], {
  stdio: 'inherit',
});
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
for (const name of ['ggml-base', 'ggml']) {
  const exports = execFileSync(
    'dumpbin.exe',
    ['/nologo', '/exports', path.join(candidate, `${name}.dll`)],
    { env, encoding: 'utf8' },
  );
  const symbols = exports.split(/\r?\n/u).flatMap((line) => {
    const match = /^\s*\d+\s+[0-9A-F]+\s+[0-9A-F]+\s+(\S+)/u.exec(line);
    return match ? [match[1]] : [];
  });
  if (!symbols.length) throw Error('IMPORT_LIBRARY_REQUIRED');
  writeFileSync(
    path.join(output, `${name}.def`),
    `LIBRARY ${name}.dll\nEXPORTS\n${symbols.join('\n')}\n`,
  );
  execFileSync(
    'lib.exe',
    [
      '/nologo',
      '/machine:x64',
      `/def:${path.join(output, `${name}.def`)}`,
      `/out:${path.join(output, `${name}.lib`)}`,
    ],
    { env, cwd: output, stdio: 'inherit' },
  );
}
const flags = [
  '/nologo',
  '/std:c++17',
  '/EHsc',
  '/O2',
  '/MD',
  '/utf-8',
  '/DNOMINMAX',
  '/DGGML_SHARED',
  '/DGGML_BACKEND_SHARED',
  '/DGGML_BACKEND_BUILD',
  '/DGGML_BACKEND_DL',
  `/I${patched}`,
  `/I${path.join(source, 'ggml/include')}`,
  `/I${path.join(source, 'ggml/src')}`,
  `/I${path.join(source, 'ggml/src/ggml-rpc')}`,
  `/I${path.join(root, 'native')}`,
  `/I${path.join(root, 'native/hash')}`,
];
execFileSync(
  'cl.exe',
  [
    '/nologo',
    '/O2',
    '/MD',
    `/I${path.join(root, 'native/hash')}`,
    '/c',
    path.join(root, 'native/hash/sha256.c'),
    `/Fo${path.join(output, 'sha256-runtime.obj')}`,
  ],
  { env, cwd: output, stdio: 'inherit' },
);
execFileSync(
  'cl.exe',
  [
    ...flags,
    '/LD',
    path.join(patched, 'ggml-rpc.cpp'),
    path.join(source, 'ggml/src/ggml-rpc/transport.cpp'),
    path.join(output, 'sha256-runtime.obj'),
    '/link',
    path.join(output, 'ggml-base.lib'),
    path.join(output, 'ggml.lib'),
    'ws2_32.lib',
    'advapi32.lib',
    `/OUT:${path.join(output, 'ggml-rpc.dll')}`,
  ],
  { env, cwd: output, stdio: 'inherit' },
);
const original = readFileSync(path.join(candidate, 'ggml-rpc.dll'));
const next = readFileSync(path.join(output, 'ggml-rpc.dll'));
if (original.equals(next)) throw Error('RUNTIME_PATCH_MISSING');
console.log('Built separate protocol-8 ggml-rpc.dll; original verified runtime untouched');
if (process.argv.includes('--test')) {
  execFileSync(
    'cl.exe',
    [
      ...flags,
      path.join(root, 'tests/native/tensor-cache-rpc-test.cc'),
      path.join(source, 'ggml/src/ggml-rpc/transport.cpp'),
      path.join(output, 'sha256-runtime.obj'),
      '/link',
      path.join(output, 'ggml-base.lib'),
      path.join(output, 'ggml.lib'),
      'ws2_32.lib',
      'advapi32.lib',
      `/OUT:${path.join(output, 'tensor-cache-rpc-test.exe')}`,
    ],
    { env, cwd: output, stdio: 'inherit' },
  );
  env.PATH = `${candidate};${env.Path ?? env.PATH ?? ''}`;
  const folder = mkdtempSync(path.join(output, 'rpc-test-'));
  try {
    execFileSync(
      path.join(output, 'tensor-cache-rpc-test.exe'),
      [folder, path.join(candidate, 'ggml-cpu-x64.dll')],
      { env, cwd: output, stdio: 'inherit' },
    );
  } finally {
    if (path.dirname(folder) === output) rmSync(folder, { recursive: true, force: true });
  }
}
