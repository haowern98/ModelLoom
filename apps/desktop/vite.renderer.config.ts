import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command, mode }) => ({
  base: './',
  plugins: [react()],
  define: {
    __DEMO_DATA_ENABLED__:
      command === 'serve' || mode === 'demo' || process.env.MODELLOOM_DEMO === '1',
  },
}));
