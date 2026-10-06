import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/hosts/windows-ownership.test.ts', 'src/hosts/hosts.test.ts'],
    fileParallelism: false,
    testTimeout: 15_000,
  },
});
