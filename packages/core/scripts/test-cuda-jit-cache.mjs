// Isolated filesystem/token tests: no CUDA, GPU work, signing or installation.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, mkdirSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';

if (process.platform !== 'win32') throw Error('Windows token tests require Windows');
const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'out/cuda-jit-cache-test');
mkdirSync(output, { recursive: true });
const setup = path.join(root, 'out/native/compiler-environment.cmd');
if (!readFileSync(setup, 'utf8').includes('vcvars64.bat')) throw Error('PINNED_COMPILER_REQUIRED');
const lines = execFileSync('cmd.exe', ['/d', '/c', setup], {
  encoding: 'utf8',
  windowsHide: true,
});
const env = Object.fromEntries(
  lines.split(/\r?\n/u).flatMap((line) => {
    const at = line.indexOf('=');
    return at > 0 ? [[line.slice(0, at), line.slice(at + 1)]] : [];
  }),
);
execFileSync(
  'cl.exe',
  [
    '/nologo',
    '/std:c++17',
    '/EHsc',
    '/W4',
    '/WX',
    '/utf-8',
    '/MT',
    '/O2',
    path.join(root, 'tests/native/cuda-jit-cache-test.cc'),
    `/Fo${path.join(output, 'test.obj')}`,
    `/Fe${path.join(output, 'test.exe')}`,
    '/link',
    'advapi32.lib',
  ],
  { cwd: output, env, stdio: 'inherit', windowsHide: true },
);
const folder = mkdtempSync(path.join(output, 'case-'));
try {
  mkdirSync(path.join(folder, 'target'));
  symlinkSync(path.join(folder, 'target'), path.join(folder, 'junction'), 'junction');
  mkdirSync(path.join(folder, 'redirect/runtimes/version'), { recursive: true });
  symlinkSync(
    path.join(folder, 'target'),
    path.join(folder, 'redirect/runtimes/modelloom-rpc-cuda-jit-v1'),
    'junction',
  );
  execFileSync(path.join(output, 'test.exe'), [folder], {
    cwd: output,
    env,
    stdio: 'inherit',
    windowsHide: true,
  });
} finally {
  if (path.dirname(folder) === output) rmSync(folder, { recursive: true, force: true });
}
