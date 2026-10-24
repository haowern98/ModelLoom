import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';

test(
  'closed helper validates the explicit GPU before asking for elevation',
  {
    skip: process.platform !== 'win32',
  },
  () => {
    const exe = fileURLToPath(new URL('../out/peer-host/ModelLoom-peer-host.exe', import.meta.url));
    const prefix = ['a'.repeat(32), String(process.pid), '--rpc-relay-cuda'];
    const run = (args) =>
      spawnSync(exe, args, {
        windowsHide: true,
        // A newly compiled unsigned image can spend several seconds in the
        // Windows scanner before main runs. This checks arguments, not startup speed.
        timeout: 20000,
        env: { ...process.env, MODELLOOM_PROBE_GPU_UUID: 'GPU-invalid' },
      });
    const uuid = 'GPU-d42a520b-020b-2673-9923-6906e674e243';
    // Ordinary execution stops at the privilege gate; it never starts a worker or installs filters.
    assert.equal(run([...prefix, uuid]).status, 740);
    for (const value of [
      '',
      'CUDA0',
      'GPU-invalid',
      uuid + 'x',
      uuid.replace('GPU-', 'gpu-'),
      uuid + ' --recover-crash',
    ])
      assert.equal(run([...prefix, value]).status, 87, value);
    assert.equal(run(prefix).status, 87);
    assert.equal(run([...prefix, uuid, 'extra']).status, 87);
    assert.equal(run([prefix[0], prefix[1], '--rpc-relay-cpu', uuid]).status, 87);
    assert.equal(run([prefix[0], prefix[1], '--recover-crash']).status, 740);
    assert.equal(run([prefix[0], prefix[1], '--rpc-session-cuda', uuid]).status, 740);
    assert.equal(run([prefix[0], prefix[1], '--rpc-session-cpu', uuid]).status, 87);
  },
);
