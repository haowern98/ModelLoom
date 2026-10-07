import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: [
      'src/hosts/windows-ownership.test.ts',
      'src/hosts/hosts.test.ts',
      'src/hosts/runtime-console.test.ts',
      'src/runtime-package/install.test.ts',
      'src/publisher/development-custody.test.ts',
    ],
    clearMocks: true,
  },
});
