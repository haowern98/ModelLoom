import { expect, it, vi } from 'vitest';
import { networkProtection } from './network-protection';
it('refuses Linux plaintext and unknown keyring backends even if encryption reports available', () => {
  const encryptString = vi.fn(() => Buffer.from('ciphertext'));
  for (const backend of ['basic_text', 'unknown']) {
    const protection = networkProtection(
      {
        isEncryptionAvailable: () => true,
        getSelectedStorageBackend: () => backend,
        encryptString,
        decryptString: () => 'plain',
      },
      'linux',
    );
    expect(protection.available()).toBe(false);
    expect(() => protection.encrypt('secret')).toThrow('NETWORK_STORAGE_UNAVAILABLE');
  }
  expect(encryptString).not.toHaveBeenCalled();
});
it('delegates to the native platform protection without a plaintext fallback', () => {
  for (const platform of ['win32', 'darwin', 'linux'] as const) {
    const protection = networkProtection(
      {
        isEncryptionAvailable: () => true,
        getSelectedStorageBackend: () => 'gnome_libsecret',
        encryptString: (value) => Buffer.from(`protected:${value}`),
        decryptString: (value) => value.toString().slice(10),
      },
      platform,
    );
    expect(protection.available()).toBe(true);
    expect(protection.decrypt(protection.encrypt('secret'))).toBe('secret');
  }
});
