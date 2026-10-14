import { expect, it } from 'vitest';
import { windowsApiKeyProtection } from './windows-protection.js';
it('protects and recovers a bounded synthetic API key under the current Windows user', () => {
  const protection = windowsApiKeyProtection();
  const key = Buffer.from(`ml_${'ab'.repeat(32)}`);
  const encrypted = protection.protect(key);
  expect(encrypted.equals(key)).toBe(false);
  expect(encrypted.includes(key)).toBe(false);
  expect(protection.unprotect(encrypted)).toEqual(key);
  expect(() => protection.unprotect(Buffer.from('invalid'))).toThrow('CREDENTIAL_UNAVAILABLE');
  expect(() => protection.protect(Buffer.alloc(4097))).toThrow('CREDENTIAL_UNAVAILABLE');
  expect(() => protection.protect(Buffer.from('not-an-api-key'))).toThrow('CREDENTIAL_UNAVAILABLE');
  expect(() => protection.unprotect(Buffer.alloc(4097))).toThrow('CREDENTIAL_UNAVAILABLE');
  const corrupted = Buffer.from(encrypted);
  corrupted.fill(0, 0, 16);
  expect(() => protection.unprotect(corrupted)).toThrow('CREDENTIAL_UNAVAILABLE');
});
