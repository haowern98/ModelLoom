import { expect, it } from 'vitest';
import { ReconnectBackoff } from './reconnect-backoff.js';

it('leaves manual pairing capacity while backing off repeated automatic failures', () => {
  let now = 0;
  const retries = new ReconnectBackoff(() => now);
  const attempts: number[] = [];
  for (now = 0; now < 120000; now += 5000) if (retries.begin('worker')) attempts.push(now);
  expect(attempts).toEqual([0, 15000, 45000, 105000]);
  expect(retries.begin('another worker')).toBe(true);
});

it('resets a healthy peer and forgets removed addresses', () => {
  const retries = new ReconnectBackoff(() => 0);
  expect(retries.begin('worker')).toBe(true);
  expect(retries.begin('worker')).toBe(false);
  retries.reset('worker');
  expect(retries.begin('worker')).toBe(true);
  retries.retain([]);
  expect(retries.begin('worker')).toBe(true);
});
