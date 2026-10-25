interface ObservedPath {
  readonly address: string;
  readonly path: 'direct' | 'relayed' | 'unknown';
  readonly observedAt?: number;
}

/** Configured relay addresses and canvas placement are not observed transport evidence. */
export function connectionRoute(
  address: string | undefined,
  paths: readonly ObservedPath[] | undefined,
  now = Date.now(),
): { network: 'LAN' | 'Tailscale' | 'Unknown'; path?: 'Direct' | 'Relayed' | 'Unknown' } {
  if (!address || !paths) return { network: 'Unknown' };
  let host: string;
  try {
    const url = new URL(address.includes('://') ? address : `http://${address}`);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    )
      return { network: 'Unknown' };
    host = url.hostname;
  } catch {
    return { network: 'Unknown' };
  }
  const observed = paths.find((item) => item.address === host);
  if (observed) {
    const fresh =
      observed.observedAt !== undefined &&
      now >= observed.observedAt &&
      now - observed.observedAt <= 15000;
    return {
      network: 'Tailscale',
      path:
        !fresh || observed.path === 'unknown'
          ? 'Unknown'
          : observed.path === 'direct'
            ? 'Direct'
            : 'Relayed',
    };
  }
  const parts = host.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255))
    return { network: 'Unknown' };
  return {
    network:
      parts[0] === 10 ||
      (parts[0] === 172 && parts[1]! >= 16 && parts[1]! <= 31) ||
      (parts[0] === 192 && parts[1] === 168)
        ? 'LAN'
        : 'Unknown',
  };
}
