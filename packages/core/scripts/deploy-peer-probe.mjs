// Copies public development assets only into the already authorized MY scratch
// deployment. Existing mismatched destinations are refused, never overwritten.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';
import { Buffer } from 'node:buffer';
import path from 'node:path';
const exec = promisify(execFile);
if (process.argv.length !== 2) throw Error('This deployment accepts no arguments');
const root = fileURLToPath(new URL('../', import.meta.url));
const local = path.join(root, 'out/activation/b11306/peers');
const remote = 'D:/ModelLoom/ModelLoom-Project-Peer-Test-20261020';
const config = 'E:/ModelLoom/.remote/modelloom-scp-config';
const ssh = ['-F', config, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8'];
async function ps(script) {
  const encoded = Buffer.from(
    "$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; " + script,
    'utf16le',
  ).toString('base64');
  try {
    return (
      await exec(
        'ssh',
        [
          ...ssh,
          'modelloom-controller',
          'powershell.exe',
          '-NoProfile',
          '-NonInteractive',
          '-EncodedCommand',
          encoded,
        ],
        { windowsHide: true, timeout: 30000, maxBuffer: 65536 },
      )
    ).stdout;
  } catch (error) {
    throw Error(String(error.stderr ?? 'Remote deployment failed').slice(-4096), { cause: error });
  }
}
const inventory = JSON.parse(await readFile(path.join(local, 'repository/inventory.json'), 'utf8'));
const missing = [];
await ps(
  `New-Item -ItemType Directory -Force -Path '${remote}/out/activation/b11306/peers/candidate','${remote}/out/activation/b11306/peers/repository','${remote}/assets' | Out-Null`,
);
for (let i = 0; i < inventory.files.length; i++) {
  const chunk = inventory.files.slice(i, i + 1);
  const commands = chunk.map((file) => {
    if (!/^[a-zA-Z0-9_.-]+$/u.test(file.path) || !/^[a-f0-9]{64}$/u.test(file.sha256))
      throw Error('Unexpected package file');
    const target = `${remote}/out/activation/b11306/peers/candidate/${file.path}`;
    const prior = `${remote}/out/network-guard-probe/stock-rpc-gpu/${file.path}`;
    return `if (Test-Path -LiteralPath '${target}') { if ((Get-FileHash -LiteralPath '${target}' -Algorithm SHA256).Hash.ToLowerInvariant() -ne '${file.sha256}') { throw 'Existing package differs' } } elseif ((Test-Path -LiteralPath '${prior}') -and (Get-FileHash -LiteralPath '${prior}' -Algorithm SHA256).Hash.ToLowerInvariant() -eq '${file.sha256}') { Copy-Item -LiteralPath '${prior}' -Destination '${target}' } else { Write-Output '${file.path}' }`;
  });
  missing.push(
    ...(await ps(commands.join('\n')))
      .split(/\r?\n/u)
      .map((s) => s.trim())
      .filter(Boolean),
  );
}
for (const name of missing)
  if (!inventory.files.some((file) => file.path === name))
    throw Error('Unexpected remote upload request');
if (missing.length)
  await exec(
    'scp',
    [
      ...ssh,
      ...missing.map((name) => path.join(local, 'candidate', name)),
      `modelloom-controller:${remote}/out/activation/b11306/peers/candidate/`,
    ],
    { windowsHide: true, timeout: 120000, maxBuffer: 65536 },
  );
await exec(
  'scp',
  [
    ...ssh,
    ...['root.json', 'timestamp.json', 'snapshot.json', 'targets.json', 'inventory.json'].map(
      (name) => path.join(local, 'repository', name),
    ),
    `modelloom-controller:${remote}/out/activation/b11306/peers/repository/`,
  ],
  { windowsHide: true, timeout: 30000 },
);
await exec(
  'scp',
  [
    ...ssh,
    path.join(root, 'assets/development-root.json'),
    `modelloom-controller:${remote}/assets/`,
  ],
  { windowsHide: true, timeout: 30000 },
);
await exec(
  'scp',
  [
    ...ssh,
    path.join(root, 'out/peer-acceptance/start-verified.mjs'),
    `modelloom-controller:${remote}/out/peers/`,
  ],
  { windowsHide: true, timeout: 30000 },
);
await exec(
  'scp',
  [
    ...ssh,
    path.join(root, 'scripts/relay-rpc-worker.ps1'),
    `modelloom-controller:${remote}/scripts/`,
  ],
  { windowsHide: true, timeout: 30000 },
);
console.log(
  (
    await ps(
      `& '${remote}/node.exe' '${remote}/out/peers/start-verified.mjs' --inspect-package; if ($LASTEXITCODE -ne 0) { throw 'Verified package inspection failed' }`,
    )
  ).trim(),
);
console.log(
  JSON.stringify({
    publicFiles: inventory.files.length,
    uploadedFiles: missing.length,
    modelTransferred: false,
  }),
);
