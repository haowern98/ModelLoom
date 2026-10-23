// Isolated diagnostic build; never rebuilds or stages a product/native runtime.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32' || process.arch !== 'x64' || process.argv.length !== 2)
  throw new Error('This isolated probe requires Windows x64 and accepts no arguments');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const peerHost = process.env.MODELLOOM_BUILD_PEER_HOST === '1';
const vswhere = path.join(
  process.env['ProgramFiles(x86)'],
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
  { encoding: 'utf8', windowsHide: true },
).trim();
const compiler = path.join(installation, 'VC/Tools/MSVC/14.44.35207/bin/Hostx64/x64/cl.exe');
const setup = path.join(installation, 'VC/Auxiliary/Build/vcvars64.bat');
for (const asset of [compiler, setup])
  if (!existsSync(asset)) throw new Error('Missing pinned MSVC tool');
const output = path.join(root, peerHost ? 'out/peer-host' : 'out/network-guard-probe');
mkdirSync(output, { recursive: true });
const environmentScript = path.join(output, 'compiler-environment.cmd');
writeFileSync(
  environmentScript,
  `@echo off\r\ncall "${setup}" >nul\r\nif errorlevel 1 exit /b 1\r\nset\r\n`,
);
const environment = execFileSync('cmd.exe', ['/d', '/c', environmentScript], {
  encoding: 'utf8',
  windowsHide: true,
});
const env = {};
for (const line of environment.split(/\r?\n/u)) {
  const index = line.indexOf('=');
  if (index > 0) env[line.slice(0, index)] = line.slice(index + 1);
}
execFileSync(
  compiler,
  [
    '/nologo',
    '/std:c++17',
    '/EHsc',
    '/W4',
    '/WX',
    '/O2',
    '/MT',
    '/utf-8',
    path.join(root, peerHost ? 'native/peer-host.cc' : 'tests/native/network-guard-probe.cc'),
    `/Fo${path.join(output, 'probe.obj')}`,
    `/Fe${path.join(output, peerHost ? 'ModelLoom-peer-host.exe' : 'network-guard-probe.exe')}`,
    '/link',
    'fwpuclnt.lib',
    'ws2_32.lib',
    'advapi32.lib',
    'user32.lib',
    'iphlpapi.lib',
    'bcrypt.lib',
    'ole32.lib',
    'oleaut32.lib',
  ],
  { cwd: output, env, stdio: 'inherit', windowsHide: true },
);
console.log(
  peerHost
    ? 'Built the closed peer-host entry; no runtime package was changed.'
    : 'Built isolated WFP diagnostic; ordinary runtime/package paths were not changed.',
);
