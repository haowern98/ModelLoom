import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'src/hosts/chat-native.test.ts',
      'src/history/windows-directory.test.ts',
      'src/model-configuration/windows-directory.test.ts',
      'src/model-configuration/windows-protection.test.ts',
      'src/local-api/windows-integration.test.ts',
      'src/hosts/windows-ownership.test.ts',
      'src/hosts/hosts.test.ts',
      'src/hosts/runtime-console.test.ts',
      'src/hosts/engine-credential.test.ts',
      'src/runtime-package/install.test.ts',
      'src/publisher/development-custody.test.ts',
    ],
    fileParallelism: false,
    testTimeout: 15_000,
  },
});
