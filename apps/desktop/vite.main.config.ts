import { defineConfig } from 'vite';

export default defineConfig({
  define: { PACKAGED_DEVELOPMENT: 'false' },
  build: {
    sourcemap: true,
    rollupOptions: { external: ['electron', 'node:path', 'node:url', 'node:crypto', 'node:os'] },
  },
});
