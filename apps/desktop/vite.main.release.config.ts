import { defineConfig, mergeConfig } from 'vite';
import ordinary from './vite.main.config';

export default mergeConfig(ordinary, defineConfig({ define: { PACKAGED_RELEASE: 'true' } }));
