import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stageDevelopment } from './stage-development.mjs';
const require = createRequire(import.meta.url);
const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const core = path.resolve(desktop, '../../packages/core');
if (process.platform !== 'win32' || process.arch !== 'x64' || process.argv.length !== 2)
  throw new Error('Windows x64 development package only');
const run = (entry, args = [], cwd = core, env = process.env) =>
  execFileSync(process.execPath, [entry, ...args], {
    cwd,
    env,
    stdio: 'inherit',
    windowsHide: true,
  });
run(require.resolve('typescript/bin/tsc'), ['-p', path.join(core, 'tsconfig.build.json')]);
run(path.join(core, 'scripts/build-development.mjs'));
await mkdir(path.join(desktop, 'out/development-stages'), { recursive: true });
const stagingRoot = await mkdtemp(path.join(desktop, 'out/development-stages/build-'));
const stage = path.join(stagingRoot, 'modelloom-development');
await stageDevelopment(stage);
delete process.env.MODELLOOM_DEMO;
const { api, utils } = await import('@electron-forge/core');
utils.registerForgeConfigForDirectory(desktop, require('../forge.development.config.cjs')(stage));
try {
  await api.package({ dir: desktop });
} finally {
  utils.unregisterForgeConfigForDirectory(desktop);
}
