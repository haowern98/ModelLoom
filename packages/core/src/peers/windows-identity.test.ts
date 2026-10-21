import { createSecureContext } from 'node:tls';
import { X509Certificate } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { openWindowsPeerIdentity, validatePeerCertificate } from './windows-identity.js';

describe('Windows peer identity', () => {
  it('keeps its public identity across protected reloads and supplies a matching TLS private key', async () => {
    const first = await openWindowsPeerIdentity();
    try {
      expect(first.fingerprint).toMatch(/^[a-f0-9]{64}$/u);
      expect(first.protectedIdentity.includes(first.pfx.subarray(0, 64))).toBe(false);
      const cert = new X509Certificate(first.certificate);
      const authority = new X509Certificate(first.authority);
      expect(cert.ca).toBe(false);
      expect(authority.ca).toBe(true);
      expect(cert.verify(authority.publicKey)).toBe(true);
      expect(validatePeerCertificate(first.certificate, first.authority)).toBe(first.fingerprint);
      expect(() => createSecureContext({ pfx: first.pfx })).not.toThrow();
      const second = await openWindowsPeerIdentity(first.protectedIdentity);
      try {
        expect(second.fingerprint).toBe(first.fingerprint);
        expect(
          new X509Certificate(second.certificate).publicKey.export({ type: 'spki', format: 'der' }),
        ).toEqual(cert.publicKey.export({ type: 'spki', format: 'der' }));
        expect(second.authority).not.toEqual(first.authority);
        expect(() => validatePeerCertificate(first.certificate, second.authority)).toThrow(
          'INVALID_PEER_CERTIFICATE',
        );
      } finally {
        second.close();
      }
    } finally {
      first.close();
    }
    expect(first.pfx.every((value) => value === 0)).toBe(true);
  }, 20_000);

  it('rejects malformed protected data instead of generating a replacement identity', async () => {
    await expect(openWindowsPeerIdentity(Buffer.from('bad'))).rejects.toThrow(
      'PEER_IDENTITY_UNAVAILABLE',
    );
  });
});
