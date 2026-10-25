import type { PeerReply } from '../peers/wire.js';
/** Renderer-safe networking data. Enrollment material never belongs in these views. */
export type NetworkState =
  | 'disconnected'
  | 'starting'
  | 'needs-login'
  | 'needs-approval'
  | 'connected'
  | 'reconnecting'
  | 'expired'
  | 'failed';
export interface NetworkCandidate {
  readonly id: string;
  readonly name: string;
  readonly fingerprint: string;
  readonly address: string;
}
export interface NetworkView {
  readonly state: NetworkState;
  readonly addresses: readonly string[];
  readonly account?: string;
  readonly tailnet?: string;
  readonly error?: string;
  readonly candidates: readonly NetworkCandidate[];
  readonly paths?: readonly {
    readonly address: string;
    readonly path: 'direct' | 'relayed' | 'unknown';
    readonly observedAt?: number;
  }[];
}
export type NetworkCommand = Readonly<{
  action: 'read' | 'connect' | 'disconnect' | 'sign-out' | 'refresh' | 'open-login';
}>;
export type NetworkReply =
  Readonly<{ ok: true; view: NetworkView }> | Readonly<{ ok: false; error: string }>;
export interface NetworkBridge {
  command(command: NetworkCommand): Promise<NetworkReply>;
  subscribe(listener: () => void): () => void;
  invite?(candidateId: string): Promise<PeerReply>;
}
const invalid = (): never => {
  throw Error('INVALID_NETWORK_CONTROL');
};
function object(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : invalid();
}
function keys(input: Record<string, unknown>, required: string[], optional: string[] = []): void {
  if (
    required.some((key) => !Object.hasOwn(input, key)) ||
    Object.keys(input).some((key) => !required.includes(key) && !optional.includes(key))
  )
    invalid();
}
function text(input: unknown, max = 255): string {
  return typeof input === 'string' &&
    input.length > 0 &&
    input.length <= max &&
    ![...input].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
    ? input
    : invalid();
}
export function decodeNetworkCommand(input: unknown): NetworkCommand {
  const value = object(input);
  keys(value, ['action']);
  if (
    !['read', 'connect', 'disconnect', 'sign-out', 'refresh', 'open-login'].includes(
      String(value.action),
    )
  )
    return invalid();
  return { action: value.action as NetworkCommand['action'] };
}
export function decodeNetworkView(input: unknown): NetworkView {
  const value = object(input);
  keys(value, ['state', 'addresses', 'candidates'], ['account', 'tailnet', 'error', 'paths']);
  const state = text(value.state) as NetworkState;
  if (
    ![
      'disconnected',
      'starting',
      'needs-login',
      'needs-approval',
      'connected',
      'reconnecting',
      'expired',
      'failed',
    ].includes(state)
  )
    return invalid();
  if (
    !Array.isArray(value.addresses) ||
    value.addresses.length > 16 ||
    !Array.isArray(value.candidates) ||
    value.candidates.length > 10000
  )
    return invalid();
  const candidates = value.candidates.map((input) => {
    const item = object(input);
    keys(item, ['id', 'name', 'fingerprint', 'address']);
    const fingerprint = text(item.fingerprint, 64);
    if (!/^[a-f0-9]{64}$/u.test(fingerprint)) return invalid();
    return {
      id: text(item.id, 160),
      name: text(item.name, 80),
      fingerprint,
      address: text(item.address),
    };
  });
  let paths: NetworkView['paths'];
  if (value.paths !== undefined) {
    if (!Array.isArray(value.paths) || value.paths.length > 10000) return invalid();
    paths = value.paths.map((input) => {
      const item = object(input);
      keys(item, ['address', 'path'], ['observedAt']);
      if (
        !['direct', 'relayed', 'unknown'].includes(String(item.path)) ||
        (item.observedAt !== undefined &&
          (!Number.isSafeInteger(item.observedAt) || (item.observedAt as number) <= 0))
      )
        return invalid();
      return {
        address: text(item.address),
        path: item.path as 'direct' | 'relayed' | 'unknown',
        ...(item.observedAt !== undefined ? { observedAt: item.observedAt as number } : {}),
      };
    });
  }
  if (new Set(candidates.map((item) => item.id)).size !== candidates.length) return invalid();
  return {
    state,
    addresses: value.addresses.map((address) => text(address)),
    candidates,
    ...(paths ? { paths } : {}),
    ...(value.account !== undefined ? { account: text(value.account) } : {}),
    ...(value.tailnet !== undefined ? { tailnet: text(value.tailnet) } : {}),
    ...(value.error !== undefined ? { error: text(value.error, 64) } : {}),
  };
}
export function decodeNetworkReply(input: unknown): NetworkReply {
  const value = object(input);
  if (value.ok === true) {
    keys(value, ['ok', 'view']);
    return { ok: true, view: decodeNetworkView(value.view) };
  }
  if (value.ok === false) {
    keys(value, ['ok', 'error']);
    return { ok: false, error: text(value.error, 64) };
  }
  return invalid();
}
export function validateLoginUrl(input: unknown): string {
  const raw = text(input, 2048);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return invalid();
  }
  if (url.origin !== 'https://login.tailscale.com' || url.username || url.password || url.hash)
    return invalid();
  return url.href;
}
