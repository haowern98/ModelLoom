import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { URL, fileURLToPath, pathToFileURL } from 'node:url';

/** One source-development entry point; the marker selects workflow, never runtime authority. */
export function launchDevelopment(args, spawn = spawnSync) {
  if (args.length !== 1 || args[0] !== 'dev')
    throw Error('Use npm run electron dev from the workspace root.');
  const desktop = new URL('../apps/desktop/', import.meta.url);
  const require = createRequire(new URL('package.json', desktop));
  const forge = require.resolve('@electron-forge/cli/dist/electron-forge.js');
  const env = { ...process.env, MODELLOOM_DEV_LAUNCH: 'electron-dev' };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.MODELLOOM_DEMO;
  const result = spawn(process.execPath, [forge, 'start'], {
    cwd: fileURLToPath(desktop),
    env,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = launchDevelopment(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
