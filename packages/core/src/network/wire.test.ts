import { describe, expect, it } from 'vitest';
import { decodeNetworkCommand, decodeNetworkReply, validateLoginUrl } from './wire.js';

describe('network boundary', () => {
  it('accepts only fixed user actions without caller-selected targets', () => {
    expect(decodeNetworkCommand({ action: 'connect' })).toEqual({ action: 'connect' });
    expect(() =>
      decodeNetworkCommand({ action: 'connect', address: 'https://evil.test' }),
    ).toThrow();
    expect(() => decodeNetworkCommand({ action: 'dial' })).toThrow();
  });
  it('rejects credentials and sign-in URLs in renderer snapshots', () => {
    expect(
      decodeNetworkReply({
        ok: true,
        view: { state: 'disconnected', addresses: [], candidates: [] },
      }).ok,
    ).toBe(true);
    expect(() =>
      decodeNetworkReply({
        ok: true,
        view: { state: 'connected', addresses: [], candidates: [], authUrl: 'secret' },
      }),
    ).toThrow();
  });
  it('permits only an exact trusted browser enrollment origin', () => {
    expect(validateLoginUrl('https://login.tailscale.com/a/123')).toBe(
      'https://login.tailscale.com/a/123',
    );
    for (const url of [
      'http://login.tailscale.com/a/1',
      'https://login.tailscale.com.evil.test/a/1',
      'https://user:pass@login.tailscale.com/a/1',
      'file:///secret',
      'https://login.tailscale.com:444/a/1',
    ])
      expect(() => validateLoginUrl(url)).toThrow();
  });
});
