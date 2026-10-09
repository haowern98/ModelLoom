import { spawnSync } from 'node:child_process';
import path from 'node:path';
import {
  initializeCustody,
  checkCustody,
  publishDevelopmentMetadata,
  renewDevelopmentMetadata,
} from '../out/publisher/development-custody.js';
import { readFile, lstat } from 'node:fs/promises';
import { ownershipBinding } from '../out/hosts/windows-ownership.js';

// Explicit standalone publisher. No imports or invocation from desktop/runtime startup.
const operation = process.argv[2];
if (!(
  (process.argv.length === 3 && ['init', 'check'].includes(operation)) ||
  (process.argv.length === 5 && ['publish', 'renew'].includes(operation))
))
  throw new Error(
    'Use init, check, publish <inventory.json> <new-repository>, or renew <previous-repository> <new-repository>',
  );
const native = ownershipBinding(),
  system = native.systemDirectory();
const query = spawnSync(
  path.join(system, 'WindowsPowerShell/v1.0/powershell.exe'),
  [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    '[Console]::Out.Write([Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData))',
  ],
  {
    windowsHide: true,
    timeout: 10000,
    maxBuffer: 65536,
    env: { SystemRoot: path.dirname(system), PATH: system },
  },
);
if (query.error || query.status !== 0) throw new Error('CUSTODY_LOCATION_FAILED');
const local = query.stdout.toString('utf8');
if (!path.isAbsolute(local) || local.includes('\0')) throw new Error('CUSTODY_LOCATION_FAILED');
const parent = path.join(local, 'ModelLoom-Publisher'),
  directory = path.join(parent, 'development');
native.privateDirectory(parent);
const receipt =
  operation === 'init' ? await initializeCustody(directory) : await checkCustody(directory);
console.log(JSON.stringify({ scope: 'development-only', directory, ...receipt }));
if (operation === 'publish') {
  const file = path.resolve(process.argv[3]);
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024)
    throw new Error('INVALID_INVENTORY');
  await publishDevelopmentMetadata(
    directory,
    JSON.parse(await readFile(file, 'utf8')),
    process.argv[4],
  );
  console.log(JSON.stringify({ published: path.resolve(process.argv[4]) }));
}
if (operation === 'renew') {
  await renewDevelopmentMetadata(
    directory,
    path.resolve(process.argv[3]),
    path.resolve(process.argv[4]),
  );
  console.log(JSON.stringify({ renewed: path.resolve(process.argv[4]) }));
}
