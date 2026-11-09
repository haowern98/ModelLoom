import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { stageRelease } from './stage-release.mjs';

const require = createRequire(import.meta.url);
const desktop = fileURLToPath(new URL('../', import.meta.url));
const core = fileURLToPath(new URL('../../../packages/core/', import.meta.url));
if (process.platform !== 'win32' || process.arch !== 'x64')
  throw new Error('Windows x64 release package only');
execFileSync(
  process.execPath,
  [require.resolve('typescript/bin/tsc'), '-p', 'tsconfig.build.json'],
  {
    cwd: core,
    stdio: 'inherit',
    windowsHide: true,
  },
);
const output = process.env.MODELLOOM_RELEASE_OUTPUT
  ? path.resolve(process.env.MODELLOOM_RELEASE_OUTPUT)
  : path.join(desktop, 'out/release');
const stages = path.join(output, 'stages');
await mkdir(stages, { recursive: true });
const stage = path.join(await mkdtemp(path.join(stages, 'build-')), 'modelloom-release');
await stageRelease(stage);

const ordinary = require('../forge.config.cjs');
const { MakerSquirrel } = require('@electron-forge/maker-squirrel');
const { VitePlugin } = require('@electron-forge/plugin-vite');
const { prepareNetworkResource } = require('./network-resource.cjs');
const { api, utils } = await import('@electron-forge/core');
delete process.env.MODELLOOM_DEMO;
utils.registerForgeConfigForDirectory(desktop, {
  ...ordinary,
  outDir: output,
  packagerConfig: { ...ordinary.packagerConfig, extraResource: [stage] },
  makers: [
    new MakerSquirrel({
      name: 'ModelLoom',
      description: 'ModelLoom desktop inference and cluster management',
      setupExe: 'ModelLoom-Setup-x64.exe',
      setupIcon: path.join(desktop, 'assets', 'modelloom.ico'),
    }),
  ],
  hooks: { prePackage: prepareNetworkResource },
  plugins: [
    new VitePlugin({
      build: [
        { entry: 'src/main/index.ts', config: 'vite.main.release.config.ts', target: 'main' },
        { entry: 'src/preload/index.ts', config: 'vite.preload.config.ts', target: 'preload' },
      ],
      renderer: [{ name: 'main_window', config: 'vite.renderer.config.ts' }],
    }),
  ],
});
try {
  await api.make({ dir: desktop, platform: 'win32', arch: 'x64' });
} finally {
  utils.unregisterForgeConfigForDirectory(desktop);
}
