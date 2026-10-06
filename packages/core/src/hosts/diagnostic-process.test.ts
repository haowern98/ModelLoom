import { spawn } from 'node:child_process';
import { expect, it } from 'vitest';
import { collectDiagnostic } from './diagnostic-process.js';

function child(code: string) {
  return spawn(process.execPath, ['-e', code], { windowsHide: true, stdio: 'pipe' });
}
it('collects a real short-lived query and waits for its closed pipes', async () => {
  const query = child("process.stdout.write('gpu data'); process.stdin.resume()");
  expect((await collectDiagnostic(query)).toString()).toBe('gpu data');
  expect(query.exitCode).toBe(0);
});
it('rejects an actual failed command', async () => {
  await expect(
    collectDiagnostic(child("process.stderr.write('failure'); process.exit(1)")),
  ).rejects.toThrow('QUERY_FAILED');
});
it('bounds combined output including stderr and confirms exit', async () => {
  const query = child("process.stderr.write('x'.repeat(65537)); setInterval(() => {}, 1000)");
  await expect(collectDiagnostic(query)).rejects.toThrow('QUERY_OUTPUT_LIMIT');
  expect(query.exitCode !== null || query.signalCode !== null).toBe(true);
});
it('accepts the output boundary and bounds the sum of both pipes', async () => {
  expect((await collectDiagnostic(child("process.stdout.write('x'.repeat(65536))"))).length).toBe(
    65536,
  );
  await expect(
    collectDiagnostic(
      child(
        "process.stdout.write('x'.repeat(32769)); process.stderr.write('x'.repeat(32769)); setInterval(() => {}, 1000)",
      ),
    ),
  ).rejects.toThrow('QUERY_OUTPUT_LIMIT');
});
it('times out a real hung child without killing another process', async () => {
  const unrelated = child('setInterval(() => {}, 1000)');
  const query = child('setInterval(() => {}, 1000)');
  try {
    await expect(collectDiagnostic(query, undefined, 150)).rejects.toThrow('QUERY_TIMEOUT');
    expect(query.exitCode !== null || query.signalCode !== null).toBe(true);
    expect(unrelated.exitCode).toBeNull();
    expect(unrelated.signalCode).toBeNull();
  } finally {
    unrelated.kill();
    await new Promise<void>((resolve) => unrelated.once('close', () => resolve()));
  }
});
it('cancels and confirms the captured query exited', async () => {
  const controller = new AbortController();
  const query = child('setInterval(() => {}, 1000)');
  const result = collectDiagnostic(query, controller.signal);
  controller.abort();
  await expect(result).rejects.toThrow('QUERY_CANCELLED');
  expect(query.exitCode !== null || query.signalCode !== null).toBe(true);
});
it('handles spawn failure without hanging', async () => {
  await expect(
    collectDiagnostic(
      spawn('modelloom-nonexistent-query-48261', [], { stdio: 'pipe', windowsHide: true }),
    ),
  ).rejects.toThrow('QUERY_FAILED');
});
