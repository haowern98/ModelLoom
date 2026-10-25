import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import * as launcher from './electron.mjs';

const check = (...args) => {
  assert.equal(typeof launcher.checkDevelopmentProfile, 'function');
  return launcher.checkDevelopmentProfile(...args);
};

test('rejects inherited Codex Windows contexts before querying or touching the profile', () => {
  for (const name of [
    'CODEX_WINDOWS_SANDBOX_PACKAGE_FAMILY',
    'CODEX_THREAD_ID',
    'CODEX_SESSION_ID',
  ]) {
    assert.throws(
      () => check('win32', { [name]: 'present' }, () => assert.fail('must not probe')),
      /normal Windows terminal/,
    );
  }
});

test('requires the read-only Windows profile probe to succeed before launch', () => {
  for (const result of [{ status: 2 }, { status: null }, { error: Error('missing powershell') }]) {
    assert.throws(
      () => check('win32', { SystemRoot: 'C:\\Windows' }, () => result),
      /normal Windows terminal/,
    );
  }
  let calls = 0;
  check('win32', { SystemRoot: 'C:\\Windows' }, (executable, args, options) => {
    calls++;
    assert.equal(executable, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    assert.ok(args.includes('-NoProfile'));
    assert.match(args.at(-1), /check-windows-profile\.ps1$/);
    assert.equal(options.windowsHide, true);
    assert.equal(options.timeout, 10000);
    return { status: 0 };
  });
  assert.equal(calls, 1);
});

test('keeps non-Windows launches independent of Windows profile probing', () => {
  for (const platform of ['darwin', 'linux'])
    check(platform, { CODEX_THREAD_ID: 'present' }, () => assert.fail('must not probe'));
});

test(
  'native probe accepts ordinary/new profiles, rejects junctions, and never reads or rewrites contents',
  { skip: process.platform !== 'win32' },
  () => {
    const parent = path.resolve('packages/core/out/setup-temp');
    mkdirSync(parent, { recursive: true });
    const root = mkdtempSync(path.join(parent, 'profile-context-'));
    const probe = (appData) =>
      spawnSync(
        path.win32.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
        [
          '-NoProfile',
          '-NonInteractive',
          '-File',
          fileURLToPath(new URL('./check-windows-profile.ps1', import.meta.url)),
        ],
        { env: { ...process.env, APPDATA: appData }, windowsHide: true, timeout: 10000 },
      );
    try {
      const profile = path.join(root, 'ModelLoom');
      const vault = path.join(profile, 'embedded-tailscale');
      mkdirSync(vault, { recursive: true });
      const key = path.join(profile, 'Local State'),
        enrollment = path.join(vault, 'enrollment.bin');
      writeFileSync(key, 'unparseable key fixture');
      writeFileSync(enrollment, 'opaque enrollment fixture');
      assert.equal(probe(root).status, 0);
      assert.equal(readFileSync(key, 'utf8'), 'unparseable key fixture');
      assert.equal(readFileSync(enrollment, 'utf8'), 'opaque enrollment fixture');
      const empty = path.join(root, 'empty');
      mkdirSync(empty);
      assert.equal(probe(empty).status, 0);
      assert.deepEqual(readdirSync(empty), []);
      const alias = path.join(root, 'alias');
      mkdirSync(alias);
      symlinkSync(profile, path.join(alias, 'ModelLoom'), 'junction');
      assert.equal(probe(alias).status, 2);
      assert.equal(readFileSync(enrollment, 'utf8'), 'opaque enrollment fixture');
    } finally {
      const target = path.resolve(root);
      assert.ok(target.startsWith(parent + path.sep));
      rmSync(target, { recursive: true, force: true });
    }
  },
);
