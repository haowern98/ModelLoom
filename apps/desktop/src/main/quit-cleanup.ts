/** Keeps network transport available until runtime and peer teardown has settled. */
export async function cleanupForQuit(
  runtime: { quit(): Promise<void> } | undefined,
  network: { close(): Promise<void> } | undefined,
): Promise<void> {
  const failures: Error[] = [];
  try {
    await runtime?.quit();
  } catch (cause) {
    failures.push(new Error('RUNTIME_CLEANUP_FAILED', { cause }));
  }
  try {
    await network?.close();
  } catch (cause) {
    failures.push(new Error('NETWORK_CLEANUP_FAILED', { cause }));
  }
  if (failures.length > 1) throw new AggregateError(failures, 'RUNTIME_AND_NETWORK_CLEANUP_FAILED');
  const failure = failures[0];
  if (failure) throw failure;
}
