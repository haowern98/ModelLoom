import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const core = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(core, 'out/exact-checkpoints');
mkdirSync(output, { recursive: true });
const lines = execFileSync(
  'cmd.exe',
  ['/d', '/c', path.join(core, 'out/native/compiler-environment.cmd')],
  { encoding: 'utf8', windowsHide: true },
);
const env = Object.fromEntries(
  lines.split(/\r?\n/u).flatMap((line) => {
    const at = line.indexOf('=');
    return at > 0 ? [[line.slice(0, at), line.slice(at + 1)]] : [];
  }),
);
const source = path.join(
  core,
  'out/tensor-cache-source/llama.cpp-4f31296a907d73f3409f720429bcf31111615d77',
);
const runtime = path.join(core, 'out/activation/b11306/candidate');
execFileSync(
  'cl.exe',
  [
    '/nologo',
    '/std:c++17',
    '/EHsc',
    '/O2',
    '/MD',
    '/W4',
    '/WX',
    '/DGGML_SHARED',
    '/DNOMINMAX',
    `/I${path.join(core, 'native')}`,
    `/I${path.join(source, 'ggml/include')}`,
    `/I${path.join(source, 'ggml/src')}`,
    path.join(core, 'tests/native/exact-checkpoint-test.cc'),
    `/Fo${path.join(output, 'test.obj')}`,
    '/link',
    path.join(core, 'out/tensor-cache-native/ggml-base.lib'),
    path.join(core, 'out/tensor-cache-native/ggml.lib'),
    `/OUT:${path.join(output, 'exact-checkpoint-test.exe')}`,
  ],
  { env, cwd: output, stdio: 'inherit', windowsHide: true },
);
env.PATH = `${runtime};${env.Path ?? env.PATH ?? ''}`;
execFileSync(
  path.join(output, 'exact-checkpoint-test.exe'),
  [path.join(runtime, 'ggml-cpu-x64.dll')],
  { env, cwd: output, stdio: 'inherit', windowsHide: true },
);
