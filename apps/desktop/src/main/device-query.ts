import { spawn } from 'node:child_process';
import path from 'node:path';
import { collectDiagnostic } from '../../../../packages/core/src/hosts/diagnostic-process';

/** Trusted collectors supply fixed OS executables/arguments, never renderer or peer input. */
export async function deviceQuery(
  executable: string,
  args: string[],
  input?: Buffer,
): Promise<Buffer> {
  return collectDiagnostic(
    spawn(executable, args, {
      windowsHide: true,
      shell: false,
      stdio: 'pipe',
      cwd: path.dirname(executable),
      env: {
        PATH:
          process.platform === 'win32'
            ? `${process.env.SystemRoot ?? 'C:\\Windows'}\\System32`
            : '/usr/bin:/usr/sbin:/bin',
        ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot } : {}),
        // The Windows NVIDIA driver needs this to resolve its NVML installation.
        ...(process.platform === 'win32' && process.env.ProgramFiles
          ? { ProgramFiles: process.env.ProgramFiles }
          : {}),
      },
    }),
    undefined,
    5000,
    input,
  );
}

export function observationNumber(
  value: unknown,
  maximum = Number.MAX_SAFE_INTEGER,
): number | undefined {
  const n = typeof value === 'string' && /^\d+(?:\.\d+)?$/u.test(value) ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= maximum ? n : undefined;
}

export function observationRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function observationList(value: unknown): Record<string, unknown>[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 4096) throw Error('INVALID_TELEMETRY');
  return value.map(observationRecord);
}

export function observationText(value: unknown): string | undefined {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 256 &&
    !Array.from(value).some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
    ? value
    : undefined;
}

export function requireCleanup(outcomes: readonly PromiseSettledResult<unknown>[]): void {
  if (
    outcomes.some(
      (r) =>
        r.status === 'rejected' &&
        r.reason instanceof Error &&
        r.reason.message === 'QUERY_CLEANUP_FAILED',
    )
  )
    throw Error('QUERY_CLEANUP_FAILED');
}
