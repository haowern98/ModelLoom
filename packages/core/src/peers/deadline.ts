/** Five seconds for approved status, 25 for RPC upgrade, plus IPC delivery margin. */
export const RPC_OPEN_MS = 31_000;

/** Local human approval belongs to sharing, not to remote worker startup. */
export const SHARING_APPROVAL_MS = 120_000;

/** Includes pending worker startup, worker close, and full helper exit confirmation. */
export const PEER_CLEANUP_MS = 75_000;

/** Only transport failures may be confirmed by retrying. Authentication,
 * authorization and malformed responses must never receive this grace. */
export function isTransientPeerFailure(error: unknown): boolean {
  if (!(error instanceof Error) || error.message !== 'PEER_UNAVAILABLE') return false;
  const cause = error.cause;
  return (
    cause instanceof Error &&
    'code' in cause &&
    ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ERR_STREAM_PREMATURE_CLOSE'].includes(
      String(cause.code),
    )
  );
}

/** A total deadline. Rejecting does not prove resource teardown; callers must
 * retain/quarantine ownership until their separate exit receipt is confirmed. */
export async function peerDeadline<T>(
  operation: Promise<T>,
  milliseconds: number,
  code: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(code)), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
