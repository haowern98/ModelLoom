import type { NetworkProtection } from '../../../../packages/core/src/network/store';
interface SafeStorage {
  isEncryptionAvailable(): boolean;
  getSelectedStorageBackend(): string;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}
/** Explicitly reject Electron's Linux basic_text fallback. Never enable plaintext encryption. */
export function networkProtection(
  storage: SafeStorage,
  platform: NodeJS.Platform = process.platform,
): NetworkProtection {
  const available = () =>
    storage.isEncryptionAvailable() &&
    (platform !== 'linux' ||
      ['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'].includes(
        storage.getSelectedStorageBackend(),
      ));
  const check = () => {
    if (!available()) throw Error('NETWORK_STORAGE_UNAVAILABLE');
  };
  return {
    available,
    encrypt(value) {
      check();
      return storage.encryptString(value);
    },
    decrypt(value) {
      check();
      return storage.decryptString(value);
    },
  };
}
