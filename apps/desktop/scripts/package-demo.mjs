import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const cli = require.resolve('@electron-forge/cli/dist/electron-forge.js');
const child = spawn(process.execPath, [cli, 'package'], {
  stdio: 'inherit',
  env: { ...process.env, MODELLOOM_DEMO: '1' },
});
child.on('error', (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
