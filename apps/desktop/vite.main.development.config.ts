import { defineConfig, mergeConfig } from 'vite';
import ordinary from './vite.main.config';

// Build-time selection only. No runtime flag or environment can activate an ordinary package.
export default mergeConfig(ordinary, defineConfig({ define: { PACKAGED_DEVELOPMENT: 'true' } }));
