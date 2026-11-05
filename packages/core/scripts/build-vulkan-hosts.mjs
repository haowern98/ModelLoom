// Separate package helpers only. Never rebuild or replace the installed CUDA hosts.
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const core = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(core, 'out/vulkan-development');
mkdirSync(out, { recursive: true });
const environment = execFileSync(
  'cmd.exe',
  ['/d', '/c', path.join(core, 'out/native/compiler-environment.cmd')],
  { encoding: 'utf8', windowsHide: true },
);
const env = Object.fromEntries(
  environment.split(/\r?\n/u).flatMap((line) => {
    const at = line.indexOf('=');
    return at > 0 ? [[line.slice(0, at), line.slice(at + 1)]] : [];
  }),
);
const headers = path.join(out, 'headers/Vulkan-Headers-1.3.290/include');
const headerSha256 = createHash('sha256')
  .update(readFileSync(path.join(headers, 'vulkan/vulkan_core.h')))
  .digest('hex');
if (headerSha256 !== '24b258dbfc5f177206fbffcf35f3a87cf756ee6f883167b92ecaeab16a5aa005')
  throw Error('VULKAN_HEADERS_MISMATCH');
const common = [
  '/nologo',
  '/std:c++17',
  '/EHsc',
  '/W4',
  '/WX',
  '/wd4191',
  '/O2',
  '/MT',
  '/utf-8',
  '/DMODELLOOM_VULKAN_HOST=1',
  `/I${headers}`,
];
for (const [source, name, libraries] of [
  ['native/runtime-control.cc', 'ModelLoom-runtime-host', ['user32.lib']],
  [
    'native/peer-host.cc',
    'ModelLoom-peer-host',
    [
      'fwpuclnt.lib',
      'ws2_32.lib',
      'advapi32.lib',
      'user32.lib',
      'iphlpapi.lib',
      'bcrypt.lib',
      'ole32.lib',
      'oleaut32.lib',
    ],
  ],
]) {
  execFileSync(
    'cl.exe',
    [
      ...common,
      path.join(core, source),
      `/Fo${path.join(out, name + '.obj')}`,
      `/Fe${path.join(out, name + '.exe')}`,
      '/link',
      ...libraries,
    ],
    { cwd: out, env, stdio: 'inherit', windowsHide: true },
  );
}
writeFileSync(
  path.join(out, 'hosts.json'),
  JSON.stringify(
    {
      headersCommit: 'b379292b2ab6df5771ba9870d53cf8b2c9295daf',
      headersSha256: createHash('sha256')
        .update(readFileSync(path.join(headers, 'vulkan/vulkan_core.h')))
        .digest('hex'),
    },
    null,
    2,
  ),
);
