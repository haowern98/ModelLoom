import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: { __DEMO_DATA_ENABLED__: true },
  test: {
    // Full-app interaction tests exceed their fixed deadline when multiple
    // jsdom workers compete on development PCs. Keep assertions and deadlines.
    maxWorkers: 1,
    environment: 'jsdom',
    setupFiles: ['tests/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    clearMocks: true,
  },
});
