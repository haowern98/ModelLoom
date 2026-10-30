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

test(
  'native relay wakes on pipe/socket readiness without timer-tick throttling',
  { skip: process.platform !== 'win32' },
  () => {
    const exe = fileURLToPath(
      new URL('../out/network-guard-probe/network-guard-probe.exe', import.meta.url),
    );
    const result = spawnSync(exe, ['--readiness-fixture'], {
      windowsHide: true,
      timeout: 20000,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout);
    assert.equal(report.correct, true);
    assert.equal(report.relayError, 0);
    assert.equal(report.echoError, 0);
    assert.equal(report.bytes, 8388608);
    assert.ok(report.milliseconds < 1000, `native loopback relay took ${report.milliseconds} ms`);
  },
);

test(
  'native readiness relay cancels pending I/O on loss, rejects oversized frames and bounds partial frames',
  { skip: process.platform !== 'win32' },
  () => {
    const exe = fileURLToPath(
      new URL('../out/network-guard-probe/network-guard-probe.exe', import.meta.url),
    );
    const result = spawnSync(exe, ['--readiness-lifecycle-fixture'], {
      windowsHide: true,
      timeout: 15000,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const reports = result.stdout
      .trim()
      .split(/\r?\n/u)
      .map((line) => JSON.parse(line));
    assert.deepEqual(
      reports.map((report) => report.scenario),
      [1, 2, 3, 4, 5, 6],
    );
    for (const report of reports) {
      assert.equal(report.correct, true);
      assert.ok(
        report.milliseconds < (report.scenario === 4 ? 6000 : 1000),
        JSON.stringify(report),
      );
    }
  },
);
