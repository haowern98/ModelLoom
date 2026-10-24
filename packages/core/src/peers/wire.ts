import { decodePeerHardware } from './hardware.js';
import type { PeerHardware } from './hardware.js';
import { decodePeerTelemetry } from './telemetry-view.js';
import type { PeerTelemetry } from './telemetry-view.js';
export type { PeerTelemetry } from './telemetry-view.js';
export interface PeerGpuView {
  readonly id: string;
  readonly name: string;
  readonly memoryBytes: number;
}
export interface PeerRequestView {
  readonly id: string;
  readonly name: string;
  readonly peerFingerprint: string;
  readonly phase: 'pending' | 'approved' | 'declined' | 'disconnected';
  readonly localVerified: boolean;
  readonly remoteVerified: boolean;
  readonly gpus: readonly PeerGpuView[];
  readonly hardware?: PeerHardware;
  readonly address?: string;
  readonly pairingCode?: string;
  readonly telemetry?: PeerTelemetry;
}
export interface PeerView {
  readonly fingerprint: string;
  readonly name: string;
  readonly sharing: boolean;
  readonly addresses: readonly string[];
  readonly gpus: readonly PeerGpuView[];
  readonly sharedGpuIds: readonly string[];
  readonly incoming: readonly PeerRequestView[];
  readonly outgoing: readonly PeerRequestView[];
}
export type PeerCommand =
  | { readonly action: 'read' | 'stop-sharing' }
  | { readonly action: 'share'; readonly address: string; readonly gpuIds: readonly string[] }
  | { readonly action: 'invite'; readonly address: string }
  | { readonly action: 'approve' | 'cancel'; readonly id: string }
  | { readonly action: 'verify-code'; readonly id: string; readonly code: string }
  | { readonly action: 'decline'; readonly id: string };
export type PeerReply =
  { readonly ok: true; readonly view: PeerView } | { readonly ok: false; readonly error: string };
export interface PeerBridge {
  command(input: PeerCommand): Promise<PeerReply>;
  subscribe?(listener: () => void): () => void;
}
function invalid(): never {
  throw new Error('INVALID_CONTROL');
}
function shape(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    return invalid();
  return value as Record<string, unknown>;
}
function string(value: unknown, max = 160): string {
  if (
    typeof value !== 'string' ||
    !value.length ||
    value.length > max ||
    [...value].some((item) => item.charCodeAt(0) < 32 || item.charCodeAt(0) === 127)
  )
    return invalid();
  return value;
}
function boolean(value: unknown): boolean {
  return typeof value === 'boolean' ? value : invalid();
}
function array<T>(value: unknown, decode: (value: unknown) => T, max = 16): T[] {
  if (!Array.isArray(value) || value.length > max) return invalid();
  return value.map(decode);
}
function fingerprint(value: unknown): string {
  const result = string(value, 64);
  return /^[a-f0-9]{64}$/u.test(result) ? result : invalid();
}
export function privatePeerHost(value: string): boolean {
  const parts = value.split('.');
  if (
    parts.length !== 4 ||
    parts.some((part) => !/^(?:0|[1-9]\d{0,2})$/u.test(part) || +part > 255)
  )
    return false;
  const [a = 0, b = 0] = parts.map(Number);
  return (
    a === 127 ||
    a === 10 ||
    (a === 192 && b === 168) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}
/** Literal private IPv4 only; no DNS, public hosts, redirects, credentials or paths. */
export function decodePeerAddress(input: unknown): URL {
  const raw = string(input, 255);
  let value: URL;
  try {
    value = new URL(
      raw.includes('://') ? raw : `http://${raw.includes(':') ? raw : `${raw}:49301`}`,
    );
  } catch {
    return invalid();
  }
  if (
    value.protocol !== 'http:' ||
    !privatePeerHost(value.hostname) ||
    value.username ||
    value.password ||
    value.pathname !== '/' ||
    value.hash ||
    value.search ||
    !value.port ||
    +value.port < 1024 ||
    +value.port > 65535
  )
    return invalid();
  return value;
}
export function decodePeerCommand(input: unknown): PeerCommand {
  const action: unknown = input && typeof input === 'object' ? Reflect.get(input, 'action') : null;
  switch (action) {
    case 'read':
    case 'stop-sharing':
      shape(input, ['action']);
      return { action };
    case 'invite': {
      const value = shape(input, ['action', 'address']);
      return { action, address: decodePeerAddress(value.address).href };
    }
    case 'share': {
      const value = shape(input, ['action', 'address', 'gpuIds']);
      const address = string(value.address, 15);
      if (!privatePeerHost(address)) return invalid();
      const gpuIds = array(value.gpuIds, (id) => string(id));
      if (new Set(gpuIds).size !== gpuIds.length) return invalid();
      return { action, address, gpuIds };
    }
    case 'verify-code': {
      const value = shape(input, ['action', 'id', 'code']);
      const code = string(value.code, 6);
      if (!/^\d{6}$/u.test(code)) return invalid();
      return { action, id: string(value.id, 36), code };
    }
    case 'approve':
    case 'cancel':
    case 'decline': {
      const value = shape(input, ['action', 'id']);
      return { action, id: string(value.id, 36) };
    }
    default:
      return invalid();
  }
}
function gpu(input: unknown): PeerGpuView {
  const value = shape(input, ['id', 'name', 'memoryBytes']);
  if (!Number.isSafeInteger(value.memoryBytes) || (value.memoryBytes as number) < 0)
    return invalid();
  return {
    id: string(value.id),
    name: string(value.name),
    memoryBytes: value.memoryBytes as number,
  };
}
function request(input: unknown): PeerRequestView {
  const optional =
    input && typeof input === 'object'
      ? ['hardware', 'address', 'pairingCode', 'telemetry'].filter((key) =>
          Object.hasOwn(input, key),
        )
      : [];
  const value = shape(input, [
    'id',
    'name',
    'peerFingerprint',
    'phase',
    'localVerified',
    'remoteVerified',
    'gpus',
    ...optional,
  ]);
  if (!['pending', 'approved', 'declined', 'disconnected'].includes(value.phase as string))
    return invalid();
  return {
    id: string(value.id, 36),
    name: string(value.name, 80),
    peerFingerprint: fingerprint(value.peerFingerprint),
    phase: value.phase as PeerRequestView['phase'],
    localVerified: boolean(value.localVerified),
    remoteVerified: boolean(value.remoteVerified),
    gpus: array(value.gpus, gpu),
    ...(value.hardware !== undefined ? { hardware: decodePeerHardware(value.hardware) } : {}),
    ...(value.telemetry !== undefined ? { telemetry: decodePeerTelemetry(value.telemetry) } : {}),
    ...(value.address !== undefined ? { address: string(value.address, 255) } : {}),
    ...(value.pairingCode !== undefined
      ? {
          pairingCode: /^\d{6}$/u.test(string(value.pairingCode, 6))
            ? (value.pairingCode as string)
            : invalid(),
        }
      : {}),
  };
}
export function decodePeerReply(input: unknown): PeerReply {
  if (input && typeof input === 'object' && Reflect.get(input, 'ok') === false) {
    const value = shape(input, ['ok', 'error']);
    const error = string(value.error, 64);
    return /^[A-Z_]+$/u.test(error) ? { ok: false, error } : invalid();
  }
  const envelope = shape(input, ['ok', 'view']);
  if (envelope.ok !== true) return invalid();
  const value = shape(envelope.view, [
    'fingerprint',
    'name',
    'sharing',
    'addresses',
    'gpus',
    'sharedGpuIds',
    'incoming',
    'outgoing',
  ]);
  return {
    ok: true,
    view: {
      fingerprint: fingerprint(value.fingerprint),
      name: string(value.name, 80),
      sharing: boolean(value.sharing),
      addresses: array(value.addresses, (item) => {
        const address = string(item, 15);
        return privatePeerHost(address) ? address : invalid();
      }),
      gpus: array(value.gpus, gpu),
      sharedGpuIds: array(value.sharedGpuIds, (id) => string(id)),
      incoming: array(value.incoming, request, 8),
      outgoing: array(value.outgoing, request, 8),
    },
  };
}
