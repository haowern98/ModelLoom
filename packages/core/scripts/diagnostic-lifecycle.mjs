/** Total wall-clock bound, including operations with no socket activity. */
export async function deadline(operation, milliseconds, code) {
  let timer;
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(code)), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Restoration steps are independent: a dead worker cannot prevent restarting
 * mining or removing this test's firewall rule. Failures remain visible. */
export async function cleanupAll(steps, milliseconds = 12000) {
  const results = await Promise.allSettled(
    steps.map((step) =>
      deadline(Promise.resolve().then(step.run), milliseconds, `${step.name}: cleanup deadline`),
    ),
  );
  const errors = results.flatMap((result, index) =>
    result.status === 'rejected'
      ? [new Error(`${steps[index].name}: ${String(result.reason?.message ?? 'cleanup failed')}`)]
      : [],
  );
  if (errors.length) throw new AggregateError(errors, 'Diagnostic cleanup incomplete');
}

/** Close only the retained diagnostic process; never terminate by image name. */
export async function stopDiagnostic(child, exited, stop = 'S', milliseconds = 8000) {
  if (!child) return;
  if (!child.stdin.destroyed && !child.stdin.writableEnded) child.stdin.end(stop);
  try {
    await deadline(exited, milliseconds, 'DIAGNOSTIC_STOP_TIMEOUT');
  } catch (error) {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await deadline(
      exited.catch(() => undefined),
      3000,
      'DIAGNOSTIC_EXIT_UNCONFIRMED',
    );
    throw error;
  }
}
import { setTimeout, clearTimeout } from 'node:timers';
