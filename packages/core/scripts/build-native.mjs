import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { createRequire } from 'node:module';

if (process.platform !== 'win32' || process.arch !== 'x64')
  throw new Error('Native development fixtures require Windows x64');
const options = process.argv.slice(2);
if (options.length > 1 || (options.length === 1 && options[0] !== '--check'))
  throw new Error('Unknown native development command');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vswhere = path.join(
  process.env['ProgramFiles(x86)'] ?? '',
  'Microsoft Visual Studio/Installer/vswhere.exe',
);
const installation = execFileSync(
  vswhere,
  [
    '-latest',
    '-products',
    '*',
    '-requires',
    'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
    '-property',
    'installationPath',
  ],
  { encoding: 'utf8' },
).trim();
const tools = path.join(installation, 'VC/Tools/MSVC/14.44.35207');
const compiler = path.join(tools, 'bin/Hostx64/x64/cl.exe');
const setup = path.join(installation, 'VC/Auxiliary/Build/vcvars64.bat');
const headers = path.join(process.env.LOCALAPPDATA ?? '', 'node-gyp/Cache/24.7.0');
for (const asset of [
  compiler,
  setup,
  path.join(headers, 'include/node/node_api.h'),
  path.join(headers, 'x64/node.lib'),
])
  if (!existsSync(asset)) throw new Error(`Missing pinned development tool: ${asset}`);
const output = path.join(root, 'out/native');
mkdirSync(output, { recursive: true });
const setupScript = path.join(output, 'compiler-environment.cmd');
writeFileSync(
  setupScript,
  `@echo off\r\ncall "${setup}" >nul\r\nif errorlevel 1 exit /b 1\r\nset\r\n`,
);
const environment = execFileSync('cmd.exe', ['/d', '/c', setupScript], { encoding: 'utf8' });
const env = {};
for (const line of environment.split(/\r?\n/u)) {
  const equals = line.indexOf('=');
  if (equals > 0) env[line.slice(0, equals)] = line.slice(equals + 1);
}
if (options[0] === '--check') {
  const sources = [
    path.join(root, 'native/windows-ownership.cc'),
    path.join(root, 'tests/native/engine-fixture.cc'),
    path.join(root, 'native/runtime-control.cc'),
    path.join(root, 'native/history-directory.cc'),
    path.join(root, 'tests/native/console-fixture.cc'),
  ];
  const llvm = path.join(installation, 'VC/Tools/Llvm/bin');
  execFileSync(
    path.join(llvm, 'clang-format.exe'),
    ['--dry-run', '--Werror', ...sources, path.join(root, 'native/engine-credential.h')],
    {
      env,
      stdio: 'inherit',
    },
  );
  execFileSync(
    path.join(llvm, 'clang-tidy.exe'),
    [
      ...sources,
      '--header-filter=[/\\\\]native[/\\\\].*',
      '--warnings-as-errors=*',
      '--',
      '-std=c++17',
      '-I',
      path.join(headers, 'include/node'),
    ],
    { env, stdio: 'inherit' },
  );
  console.log('Owned native formatting and clang-tidy checks passed');
  process.exit(0);
}
const common = ['/nologo', '/std:c++17', '/EHsc', '/W4', '/WX', '/O2', '/MT', '/utf-8'];
const require = createRequire(new URL('../package.json', import.meta.url));
if (require('node-gyp/package.json').version !== '12.4.0')
  throw new Error('Unexpected native loader tooling version');
const delayHook = path.join(
  path.dirname(require.resolve('node-gyp/package.json')),
  'src/win_delay_load_hook.cc',
);
// Reuse node-gyp's installed loader hook; no custom symbol resolver or copied upstream source.
execFileSync(
  compiler,
  [
    ...common,
    '/c',
    '/DHOST_BINARY="node.exe"',
    delayHook,
    `/Fo${path.join(output, 'delay-hook.obj')}`,
  ],
  { cwd: output, env, stdio: 'inherit' },
);
execFileSync(
  compiler,
  [
    ...common,
    '/LD',
    `/I${path.join(headers, 'include/node')}`,
    path.join(root, 'native/windows-ownership.cc'),
    `/Fo${path.join(output, 'ownership.obj')}`,
    '/link',
    path.join(output, 'delay-hook.obj'),
    path.join(headers, 'x64/node.lib'),
    'delayimp.lib',
    'advapi32.lib',
    'iphlpapi.lib',
    'ws2_32.lib',
    'shell32.lib',
    'ole32.lib',
    '/DELAYLOAD:node.exe',
    `/OUT:${path.join(output, 'ownership.node')}`,
  ],
  { cwd: output, env, stdio: 'inherit' },
);
execFileSync(
  compiler,
  [
    ...common,
    path.join(root, 'tests/native/engine-fixture.cc'),
    `/Fo${path.join(output, 'fixture.obj')}`,
    `/Fe${path.join(output, 'engine-fixture.exe')}`,
  ],
  { cwd: output, env, stdio: 'inherit' },
);
for (const [source, name] of [
  ['native/runtime-control.cc', 'ModelLoom-runtime-host'],
  ['tests/native/console-fixture.cc', 'console-fixture'],
]) {
  execFileSync(
    compiler,
    [
      ...common,
      path.join(root, source),
      `/Fo${path.join(output, `${name}.obj`)}`,
      `/Fe${path.join(output, `${name}.exe`)}`,
      '/link',
      'user32.lib',
      'ws2_32.lib',
    ],
    { cwd: output, env, stdio: 'inherit' },
  );
}
execFileSync(
  compiler,
  [
    ...common,
    '/LD',
    `/I${path.join(headers, 'include/node')}`,
    path.join(root, 'native/history-directory.cc'),
    `/Fo${path.join(output, 'history.obj')}`,
    '/link',
    path.join(output, 'delay-hook.obj'),
    path.join(headers, 'x64/node.lib'),
    'delayimp.lib',
    'advapi32.lib',
    'crypt32.lib',
    '/DELAYLOAD:node.exe',
    `/OUT:${path.join(output, 'history.node')}`,
  ],
  { cwd: output, env, stdio: 'inherit' },
);
console.log(
  'Built Windows x64 ownership binding and harmless engine fixture with MSVC 14.44.35207 /W4 /WX',
);
