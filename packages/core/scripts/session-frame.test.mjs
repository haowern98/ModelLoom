import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';

test(
  'native framing drains complete bytes without yielding and preserves partial frames and bounds',
  { skip: process.platform !== 'win32' },
  () => {
    const exe = fileURLToPath(
      new URL('../out/network-guard-probe/network-guard-probe.exe', import.meta.url),
    );
    const result = spawnSync(exe, ['--session-frame-fixture'], {
      windowsHide: true,
      timeout: 20000,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      complete: true,
      fragmented: true,
      sequential: true,
      bounded: true,
      ownerLoss: true,
    });
  },
);
