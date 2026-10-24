import { test } from 'node:test';
import { Buffer } from 'node:buffer';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';

test(
  'worker access preparation works without audit privilege and preserves private ownership',
  {
    skip: process.platform !== 'win32',
  },
  async () => {
    const native = createRequire(import.meta.url)('../out/native/ownership.node');
    const parent = fileURLToPath(new URL('../out/runtime-access-tests/', import.meta.url));
    await mkdir(parent, { recursive: true });
    const root = await mkdtemp(path.join(parent, 'access-'));
    const runtime = path.join(root, 'runtime');
    native.privateDirectory(runtime);
    const source = await readFile(new URL('./relay-rpc-worker.ps1', import.meta.url), 'utf8');
    const prefix = source.slice(0, source.indexOf('Add-Type -TypeDefinition'));
    assert(prefix.includes('Set-Acl') || prefix.includes('SetAccessControl'));
    const names = [...prefix.matchAll(/'([^']+[.](?:dll|exe))'/gu)].map((match) => match[1]);
    for (const name of new Set(names)) await writeFile(path.join(runtime, name), 'fixture');
    const lock = native.sealFiles([...new Set(names)].map((name) => path.join(runtime, name)));
    try {
      const quoted = runtime.replaceAll("'", "''");
      const script = `
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$runtime='${quoted}'
$before=[IO.Directory]::GetAccessControl($runtime)
$sections=[Security.AccessControl.AccessControlSections]::Owner -bor [Security.AccessControl.AccessControlSections]::Group
$owner=$before.GetSecurityDescriptorSddlForm($sections)
$principal=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Test requires ordinary app token'}
& { ${prefix} } -HelperImage (Join-Path $runtime 'ModelLoom-peer-host.exe')
$after=[IO.Directory]::GetAccessControl($runtime)
if($owner -ne $after.GetSecurityDescriptorSddlForm($sections)){throw 'Ownership changed'}
if(-not $after.AreAccessRulesProtected){throw 'Private inheritance changed'}
$users='S-1-5-32-545'
foreach($item in @(Get-Item -LiteralPath $runtime) + @(Get-ChildItem -LiteralPath $runtime -File | Where-Object Name -ne 'ModelLoom-peer-host.exe')) {
  $rules=@($item.GetAccessControl().GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]) | Where-Object {$_.IdentityReference.Value -eq $users})
  if($rules.Count -ne 1){throw 'Missing restricted worker read access'}
  if($rules[0].AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or ($rules[0].FileSystemRights -band [Security.AccessControl.FileSystemRights]::Write)){throw 'Excess worker access'}
}
'access-prepared-without-elevation'
`;
      const result = await promisify(execFile)(
        path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
        [
          '-NoProfile',
          '-NonInteractive',
          '-EncodedCommand',
          Buffer.from(script, 'utf16le').toString('base64'),
        ],
        {
          windowsHide: true,
          timeout: 15000,
          maxBuffer: 16384,
          env: {
            SystemRoot: process.env.SystemRoot,
            PATH: path.join(process.env.SystemRoot, 'System32'),
            MODELLOOM_PROBE_GPU_UUID: 'GPU-d42a520b-020b-2673-9923-6906e674e243',
          },
        },
      ).then(
        (result) => ({ ...result, code: 0 }),
        (error) => ({ stdout: error.stdout, stderr: error.stderr, code: error.code }),
      );
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, /access-prepared-without-elevation/u);
    } finally {
      native.releaseFiles(lock);
      assert.equal(path.dirname(root), path.resolve(parent));
      await rm(root, { recursive: true, force: true });
    }
  },
);
