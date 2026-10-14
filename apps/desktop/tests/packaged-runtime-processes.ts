import { execFileSync } from 'node:child_process';

export interface ProcessIdentity {
  pid: number;
  parent: number;
  name: string;
  image: string;
  created: string;
}

/** Read process identity only; command lines and credentials never enter test evidence. */
export function processIdentities(): ProcessIdentity[] {
  const result = execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "@(Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{pid=$_.ProcessId;parent=$_.ParentProcessId;name=$_.Name;image=$_.ExecutablePath;created=$_.CreationDate.ToUniversalTime().ToString('o')} }) | ConvertTo-Json -Compress",
    ],
    { encoding: 'utf8', windowsHide: true },
  );
  const parsed: unknown = JSON.parse(result);
  if (!Array.isArray(parsed)) throw new Error('INVALID_PROCESS_SNAPSHOT');
  return parsed.map((input: unknown) => {
    if (!input || typeof input !== 'object') throw new Error('INVALID_PROCESS_SNAPSHOT');
    const entry = input as Record<string, unknown>;
    if (
      typeof entry.pid !== 'number' ||
      typeof entry.parent !== 'number' ||
      typeof entry.name !== 'string' ||
      (entry.image !== null && typeof entry.image !== 'string') ||
      (entry.created !== null && typeof entry.created !== 'string')
    ) {
      throw new Error('INVALID_PROCESS_SNAPSHOT');
    }
    return {
      pid: entry.pid,
      parent: entry.parent,
      name: entry.name,
      image: entry.image ?? '',
      created: entry.created ?? '',
    };
  });
}

export function ownedProcesses(root: number): ProcessIdentity[] {
  const table = processIdentities();
  const owned = new Set([root]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const entry of table) {
      if (owned.has(entry.parent) && !owned.has(entry.pid)) {
        owned.add(entry.pid);
        changed = true;
      }
    }
  }
  return table.filter((entry) => owned.has(entry.pid));
}

export function survivingProcesses(captured: readonly ProcessIdentity[]): ProcessIdentity[] {
  return processIdentities().filter((current) =>
    captured.some((old) => old.pid === current.pid && old.created === current.created),
  );
}

/** Select runtime roles only inside an already captured owned process tree. */
export function runtimeProcesses(captured: readonly ProcessIdentity[]): ProcessIdentity[] {
  return captured.filter((entry) =>
    ['llama-server.exe', 'modelloom-runtime-host.exe'].includes(entry.name.toLowerCase()),
  );
}

export function runtimeServer(captured: readonly ProcessIdentity[]): ProcessIdentity | undefined {
  const servers = runtimeProcesses(captured).filter(
    (entry) => entry.name.toLowerCase() === 'llama-server.exe',
  );
  return servers.length === 1 ? servers[0] : undefined;
}

/** Retain a .NET process handle, check creation time/image, then stop only that captured process. */
export function terminateCaptured(entry: ProcessIdentity): void {
  if (!Number.isSafeInteger(entry.pid) || entry.pid < 1) throw new Error('INVALID_TEST_PID');
  const identity = JSON.stringify(entry).replaceAll("'", "''");
  execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `$identity = '${identity}' | ConvertFrom-Json; $captured = [System.Diagnostics.Process]::GetProcessById($identity.pid); $null = $captured.Handle; $current = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $identity.pid); if ($captured.HasExited -or $current.CreationDate.ToUniversalTime().ToString('o') -ne $identity.created -or $captured.MainModule.FileName -ne $identity.image) { throw 'Test process identity changed' }; $captured.Kill(); $captured.WaitForExit(2000) | Out-Null; $captured.Dispose()`,
    ],
    { encoding: 'utf8', windowsHide: true },
  );
}
