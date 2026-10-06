import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'src/hosts/windows-ownership.test.ts',
      'src/hosts/hosts.test.ts',
      'src/hosts/runtime-console.test.ts',
      'src/runtime-package/install.test.ts',
    ],
    fileParallelism: false,
    testTimeout: 15_000,
  },
});
