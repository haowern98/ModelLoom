import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [react()],
  server: { watch: { ignored: ['**/out/**'] } },
  define: {
    __DEMO_DATA_ENABLED__: mode === 'demo' || process.env.MODELLOOM_DEMO === '1',
  },
}));
