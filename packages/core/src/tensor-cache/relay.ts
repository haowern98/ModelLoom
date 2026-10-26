import { decodeCacheSettings } from './wire.js';
import type { CacheSettings } from './wire.js';
import path from 'node:path';

/** Private parent-to-helper control only. Remote RPC payloads never enter this
 * decoder, and the coordinator never supplies a worker's path or disk limits. */
export function cacheRelayPayload(input?: CacheSettings, owner?: string): Buffer {
  if (!input?.enabled) return Buffer.alloc(0);
  const settings = decodeCacheSettings(input);
  if (typeof owner !== 'string' || !/^[a-f0-9]{64}$/u.test(owner)) throw Error('INVALID_CONTROL');
  if (!path.isAbsolute(settings.location)) throw Error('INVALID_CONTROL');
  const root = Buffer.from(settings.location, 'utf8');
  if (root.length > 4096) throw Error('INVALID_CONTROL');
  const bytes = Buffer.alloc(82 + root.length);
  bytes[0] = 1;
  bytes[1] = settings.policy === 'replace' ? 1 : 0;
  bytes.writeBigUInt64LE(BigInt(settings.limitGiB) * (1n << 30n), 2);
  bytes.writeBigUInt64LE(BigInt(settings.reserveGiB) * (1n << 30n), 10);
  bytes.write(owner, 18, 64, 'ascii');
  root.copy(bytes, 82);
  return bytes;
}
