import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['src/hosts/windows-ownership.test.ts', 'src/hosts/hosts.test.ts'],
    clearMocks: true,
  },
});
