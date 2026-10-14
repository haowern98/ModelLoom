import { execFileSync } from 'node:child_process';
import type { ProcessIdentity } from './packaged-runtime-processes';

/** Request a native breakpoint in the retained test process; require its unhandled-fault exit. */
export function faultCaptured(entry: ProcessIdentity): number {
  if (!Number.isSafeInteger(entry.pid) || entry.pid < 1 || !entry.image || !entry.created)
    throw new Error('INVALID_TEST_PROCESS_IDENTITY');
  const identity = JSON.stringify(entry).replaceAll("'", "''");
  let output: string;
  try {
    output = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ModelLoomNativeFault {
  [DllImport("kernel32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool DebugBreakProcess(IntPtr process);
}
'@
$identity = '${identity}' | ConvertFrom-Json
$captured = [System.Diagnostics.Process]::GetProcessById($identity.pid)
try {
  $handle = $captured.Handle
  $current = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $identity.pid)
  if ($captured.HasExited -or $null -eq $current -or
      $current.CreationDate.ToUniversalTime().ToString('o') -cne $identity.created -or
      $captured.MainModule.FileName -ine $identity.image) {
    throw 'TEST_PROCESS_IDENTITY_CHANGED'
  }
  if (-not [ModelLoomNativeFault]::DebugBreakProcess($handle)) {
    throw 'TEST_NATIVE_BREAKPOINT_FAILED'
  }
  if (-not $captured.WaitForExit(10000)) { throw 'TEST_NATIVE_FAULT_EXIT_TIMEOUT' }
  $unsigned = [BitConverter]::ToUInt32([BitConverter]::GetBytes([int]$captured.ExitCode), 0)
  if ($unsigned -ne 2147483651) { throw 'TEST_NATIVE_FAULT_UNEXPECTED_EXIT' }
  Write-Output $unsigned
} finally {
  $captured.Dispose()
}`,
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 20_000, stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch (error) {
    // Do not let execFileSync print its complete command or the captured identity.
    const stderr =
      error && typeof error === 'object' && 'stderr' in error ? String(error.stderr) : '';
    const failure =
      /TEST_(?:PROCESS_IDENTITY_CHANGED|NATIVE_BREAKPOINT_FAILED|NATIVE_FAULT_EXIT_TIMEOUT|NATIVE_FAULT_UNEXPECTED_EXIT)/u.exec(
        stderr,
      )?.[0];
    // eslint-disable-next-line preserve-caught-error -- The original error embeds the complete command and process identity.
    throw new Error(failure ?? 'TEST_NATIVE_FAULT_COMMAND_FAILED');
  }
  const code = Number(output.trim());
  if (code !== 0x80000003) throw new Error('TEST_NATIVE_FAULT_UNEXPECTED_EXIT');
  return code;
}
