/** Observations for one authenticated coordinator-to-worker control connection.
 * Transfer rates count application RPC bytes, not NIC-wide traffic. */
export interface PeerTelemetry {
  readonly state: 'idle' | 'testing' | 'active' | 'unavailable' | 'unsupported';
  readonly latencyMs: number | null;
  readonly latencyMeasuredAt: number | null;
  readonly uploadMbps: number | null;
  readonly downloadMbps: number | null;
  readonly bandwidthMeasuredAt: number | null;
  readonly sendingBytesPerSecond: number;
  readonly receivingBytesPerSecond: number;
}

export function emptyTelemetry(): PeerTelemetry {
  return {
    state: 'idle',
    latencyMs: null,
    latencyMeasuredAt: null,
    uploadMbps: null,
    downloadMbps: null,
    bandwidthMeasuredAt: null,
    sendingBytesPerSecond: 0,
    receivingBytesPerSecond: 0,
  };
}

/** Strictly bounded, optional extension: old reporters remain readable. */
export function decodePeerTelemetry(input: unknown): PeerTelemetry {
  const keys = Object.keys(emptyTelemetry());
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(input, key))
  )
    throw Error('INVALID_CONTROL');
  const value = input as Record<string, unknown>;
  if (!['idle', 'testing', 'active', 'unavailable', 'unsupported'].includes(value.state as string))
    throw Error('INVALID_CONTROL');
  for (const key of keys.filter((key) => key !== 'state')) {
    const number = value[key];
    const nullable = !['sendingBytesPerSecond', 'receivingBytesPerSecond'].includes(key);
    if (
      !(nullable && number === null) &&
      (typeof number !== 'number' ||
        !Number.isFinite(number) ||
        number < 0 ||
        number > Number.MAX_SAFE_INTEGER)
    )
      throw Error('INVALID_CONTROL');
  }
  return { ...value } as unknown as PeerTelemetry;
}
