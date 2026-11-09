import { execFile } from 'node:child_process';
import { lstat, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { ownershipBinding } from '../hosts/windows-ownership.js';
import { downloadRuntimeCatalogTarget } from './catalog-download.js';
import { installExpanded } from './install.js';
import { METADATA_LIMIT } from './inventory.js';
import { requireLivePackage } from './verifier.js';
import type { VerifiedPackage } from './verifier.js';

const run = promisify(execFile);
// Only recognized regular-file paths are materialized. ZIP attributes are never applied.
const expand = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($env:MODELLOOM_PACK_ARCHIVE)
try {
  if ($archive.Entries.Count -gt 320) { throw 'Too many runtime archive entries' }
  $allow = @{}
  if ($env:MODELLOOM_PACK_PHASE -eq 'candidate') {
    foreach ($file in (ConvertFrom-Json ([IO.File]::ReadAllText((Join-Path $env:MODELLOOM_PACK_STAGE 'files.json'))))) {
      $allow.Add($file.path, $file)
    }
  }
  $seen = @{}
  foreach ($entry in $archive.Entries) {
    $name = $entry.FullName
    if ($env:MODELLOOM_PACK_PHASE -eq 'metadata') {
      if ($name -cnotmatch '^repository/(?:(?:[1-9][0-9]*\.)?(?:root|snapshot|targets)|timestamp|inventory)\.json$') { continue }
      $limit = [long]$env:MODELLOOM_PACK_METADATA_LIMIT
    } else {
      if ($name -cnotmatch '^candidate/' -or $name.EndsWith('/')) { continue }
      $file = $allow[$name]
      if ($null -eq $file -or $file.path -cne $name -or $entry.Length -ne $file.length) { throw 'Unexpected runtime file' }
      $limit = [long]$file.length
    }
    if ($seen.ContainsKey($name) -or $entry.Length -lt 1 -or $entry.Length -gt $limit) { throw 'Invalid runtime archive entry' }
    $seen.Add($name, $true)
    $target = Join-Path $env:MODELLOOM_PACK_STAGE $name
    [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target))
    $inputStream = $entry.Open()
    try {
      $outputStream = [IO.File]::Open($target, [IO.FileMode]::CreateNew)
      try {
        $buffer = New-Object byte[] 65536
        $remaining = $entry.Length
        while (($read = $inputStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
          $remaining -= $read
          if ($remaining -lt 0) { throw 'Runtime archive entry exceeds its declared length' }
          $outputStream.Write($buffer, 0, $read)
        }
        if ($remaining -ne 0) { throw 'Truncated runtime archive entry' }
      } finally { $outputStream.Dispose() }
    } finally { $inputStream.Dispose() }
  }
} finally { $archive.Dispose() }
`;

/** Install a catalog archive using a host-owned package verifier and verification state. */
export async function installRuntimeCatalogTarget({
  root,
  backend,
  endpoints,
  store,
  repository,
  verify,
}: {
  root: Buffer;
  backend: 'cuda' | 'vulkan';
  endpoints: { metadata: string; assets: string };
  store: string;
  repository: string;
  verify: (repository: string) => Promise<VerifiedPackage>;
}) {
  const directory = path.resolve(store);
  const ownership = ownershipBinding();
  ownership.privateDirectory(directory);
  const stage = await mkdtemp(path.join(directory, '.catalog-install-'));
  try {
    const archive = await downloadRuntimeCatalogTarget(root, backend, stage, endpoints);
    const powershell = path.join(
      ownership.systemDirectory(),
      'WindowsPowerShell/v1.0/powershell.exe',
    );
    const encoded = Buffer.from(expand, 'utf16le').toString('base64');
    const extract = (phase: 'metadata' | 'candidate') =>
      run(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
        windowsHide: true,
        timeout: 300_000,
        env: {
          ...process.env,
          MODELLOOM_PACK_ARCHIVE: archive,
          MODELLOOM_PACK_STAGE: stage,
          MODELLOOM_PACK_PHASE: phase,
          MODELLOOM_PACK_METADATA_LIMIT: String(METADATA_LIMIT),
        },
      });
    await extract('metadata');
    const stagedRepository = path.join(stage, 'repository');
    const capability = await verify(stagedRepository);
    const { inventory } = requireLivePackage(capability);
    if (inventory.backend !== backend) throw new Error('UNSUPPORTED_RUNTIME');
    const existing = await lstat(repository).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    });
    if (existing) {
      if (!existing.isDirectory() || existing.isSymbolicLink()) throw new Error('INVALID_STATE');
      const retained = requireLivePackage(await verify(repository)).inventory;
      if (JSON.stringify(retained) !== JSON.stringify(inventory))
        throw new Error('UNSUPPORTED_RUNTIME');
    }
    await writeFile(
      path.join(stage, 'files.json'),
      JSON.stringify(
        inventory.files.map(({ path, length }) => ({ path: `candidate/${path}`, length })),
      ),
      { flag: 'wx' },
    );
    await extract('candidate');
    const installed = await installExpanded(capability, path.join(stage, 'candidate'), directory);
    // Keep the signed inventory so a fresh process can reconstruct the install receipt.
    if (!existing) await rename(stagedRepository, repository);
    return installed;
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}
