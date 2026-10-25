import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { URL, fileURLToPath, pathToFileURL } from 'node:url';

/** A workflow guard, not an authorization boundary. Never open a redirected credential profile. */
export function checkDevelopmentProfile(
  platform = process.platform,
  env = process.env,
  run = spawnSync,
) {
  if (platform !== 'win32') return;
  const message =
    'Start ModelLoom from a normal Windows terminal outside Codex: npm run electron dev. The redirected profile was not opened.';
  if (
    ['CODEX_WINDOWS_SANDBOX_PACKAGE_FAMILY', 'CODEX_THREAD_ID', 'CODEX_SESSION_ID'].some(
      (key) => env[key],
    )
  )
    throw Error(message);
  if (!env.SystemRoot || !path.win32.isAbsolute(env.SystemRoot)) throw Error(message);
  const result = run(
    path.win32.join(env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    [
      '-NoProfile',
      '-NonInteractive',
      '-File',
      fileURLToPath(new URL('./check-windows-profile.ps1', import.meta.url)),
    ],
    { env, windowsHide: true, encoding: 'utf8', timeout: 10000 },
  );
  if (result.error || result.status !== 0) throw Error(message);
}

/** One source-development entry point; the marker selects workflow, never runtime authority. */
export function launchDevelopment(args, spawn = spawnSync, check = checkDevelopmentProfile) {
  if (args.length !== 1 || args[0] !== 'dev')
    throw Error('Use npm run electron dev from the workspace root.');
  check();
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
