import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';
import { deadline } from './diagnostic-lifecycle.mjs';

test(
  'the Windows lease watchdog expires with its input pipe held open, without mining access',
  { skip: process.platform !== 'win32' },
  async () => {
    const child = spawn(
      `${process.env.SystemRoot}/System32/WindowsPowerShell/v1.0/powershell.exe`,
      [
        '-NoProfile',
        '-NonInteractive',
        '-File',
        fileURLToPath(new URL('./mining-test-lease.ps1', import.meta.url)),
        '-TimeoutSelfTest',
      ],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    let output = '',
      error = '';
    child.stdout.on('data', (value) => {
      output += value.toString();
    });
    child.stderr.on('data', (value) => {
      error += value.toString();
    });
    const exited = new Promise((resolve, reject) => {
      child.once('exit', resolve);
      child.once('error', reject);
    });
    try {
      assert.equal(await deadline(exited, 8000, 'LEASE_SELF_TEST_TIMEOUT'), 0, error);
      assert.match(output, /lease-timeout-confirmed/u);
    } finally {
      child.stdin.destroy();
      if (child.exitCode === null) child.kill();
    }
  },
);
