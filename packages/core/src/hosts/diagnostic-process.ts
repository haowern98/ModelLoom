import type { ChildProcessWithoutNullStreams } from 'node:child_process';

/** Consumes one freshly captured diagnostic child. Closes stdin, bounds combined output and waits
 * for close after retained-handle termination. Never searches for a PID or kills by image name.
 * The trusted caller must choose a fixed executable and arguments; this helper accepts no command.
 */
export function collectDiagnostic(
  child: ChildProcessWithoutNullStreams,
  signal?: AbortSignal,
  timeoutMs = 2000,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let failure: string | undefined,
      size = 0,
      cleanup: NodeJS.Timeout | undefined;
    const chunks: Buffer[] = [];
    const finish = (code: number | null) => {
      clearTimeout(deadline);
      clearTimeout(cleanup);
      signal?.removeEventListener('abort', cancel);
      if (failure || code !== 0) reject(new Error(failure ?? 'QUERY_FAILED'));
      else resolve(Buffer.concat(chunks));
    };
    const stop = (code: string) => {
      if (failure) return;
      failure = code;
      child.kill('SIGKILL');
      // A failed termination is not reported as completed cleanup.
      cleanup = setTimeout(() => {
        clearTimeout(deadline);
        signal?.removeEventListener('abort', cancel);
        reject(new Error('QUERY_CLEANUP_FAILED'));
      }, 2000);
    };
    const cancel = () => stop('QUERY_CANCELLED');
    const consume = (chunk: Buffer, stdout: boolean) => {
      size += chunk.length;
      if (size > 65536) stop('QUERY_OUTPUT_LIMIT');
      else if (stdout && !failure) chunks.push(chunk);
    };
    child.stdout.on('data', (chunk: Buffer) => consume(chunk, true));
    child.stderr.on('data', (chunk: Buffer) => consume(chunk, false));
    child.once('error', () => stop('QUERY_FAILED'));
    child.stdin.on('error', () => stop('QUERY_FAILED'));
    child.once('close', finish);
    const deadline = setTimeout(() => stop('QUERY_TIMEOUT'), timeoutMs);
    signal?.addEventListener('abort', cancel, { once: true });
    child.stdin.end();
    if (signal?.aborted) cancel();
  });
}
