import { expect, it } from 'vitest';
import { cacheRelayPayload } from './relay.js';
import path from 'node:path';
it('encodes only captured local settings and preserves an empty legacy/off Open', () => {
  expect(cacheRelayPayload()).toEqual(Buffer.alloc(0));
  expect(
    cacheRelayPayload({
      enabled: false,
      limitGiB: 10,
      reserveGiB: 5,
      policy: 'keep',
      location: 'E:\\cache',
    }),
  ).toEqual(Buffer.alloc(0));
  const location = path.resolve('out/模型/cache');
  const bytes = cacheRelayPayload(
    { enabled: true, limitGiB: 20, reserveGiB: 6, policy: 'keep', location },
    'a'.repeat(64),
  );
  expect(bytes.subarray(0, 2)).toEqual(Buffer.from([1, 0]));
  expect(bytes.readBigUInt64LE(2)).toBe(20n * 2n ** 30n);
  expect(bytes.readBigUInt64LE(10)).toBe(6n * 2n ** 30n);
  expect(bytes.subarray(18, 82).toString('ascii')).toBe('a'.repeat(64));
  expect(bytes.subarray(82).toString('utf8')).toBe(location);
});
it('rejects relative paths, NULs and unknown policy fields', () => {
  const settings = {
    enabled: true,
    limitGiB: 10,
    reserveGiB: 5,
    policy: 'replace' as const,
    location: 'relative',
  };
  expect(() => cacheRelayPayload(settings)).toThrow('INVALID_CONTROL');
  expect(() => cacheRelayPayload({ ...settings, location: 'E:\\cache\0other' })).toThrow(
    'INVALID_CONTROL',
  );
});
