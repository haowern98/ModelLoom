const { test } = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { prepareNetworkResource } = require('./network-resource.cjs');

test('network resource verifies before staging only the declared files and preserves runtime resources', (t) => {
  const calls = [];
  t.mock.method(childProcess, 'execFileSync', (...args) => calls.push(['verify', ...args]));
  t.mock.method(fs, 'rmSync', (...args) => calls.push(['remove', ...args]));
  t.mock.method(fs, 'mkdirSync', (...args) => calls.push(['mkdir', ...args]));
  t.mock.method(fs, 'copyFileSync', (...args) => calls.push(['copy', ...args]));
  const config = { packagerConfig: { extraResource: ['owned-runtime'] } };
  prepareNetworkResource(config, 'win32', 'x64');
  assert.equal(calls[0][0], 'verify');
  assert.deepEqual(calls[0][2].slice(-3), ['--target', 'windows-amd64', '--check']);
  assert.deepEqual(
    calls.filter(([kind]) => kind === 'copy').map(([, source]) => path.basename(source)),
    ['modelloom-network.exe', 'manifest.json', 'THIRD-PARTY-NOTICES.txt'],
  );
  assert.equal(config.packagerConfig.extraResource[0], 'owned-runtime');
  assert.equal(path.basename(config.packagerConfig.extraResource[1]), 'tailscale');
  assert.ok(
    config.packagerConfig.extraResource[1].endsWith(path.join('windows-amd64', 'tailscale')),
  );
});

test('invalid or unverified networking artifacts cannot reach packaging', (t) => {
  const config = { packagerConfig: {} };
  let stages = 0;
  t.mock.method(fs, 'mkdirSync', () => {
    stages += 1;
  });
  t.mock.method(childProcess, 'execFileSync', () => {
    throw new Error('Checksum mismatch');
  });
  assert.throws(() => prepareNetworkResource(config, 'linux', 'all'), /Unsupported/);
  assert.throws(() => prepareNetworkResource(config, 'linux', 'arm64'), /Checksum mismatch/);
  assert.equal(stages, 0);
  assert.equal(config.packagerConfig.extraResource, undefined);
});

test('ordinary and development configurations both enforce networking verification', () => {
  const ordinary = require('../forge.config.cjs');
  const development = require('../forge.development.config.cjs')(
    path.resolve('modelloom-development'),
  );
  assert.equal(typeof ordinary.hooks.prePackage, 'function');
  assert.equal(development.hooks.prePackage, prepareNetworkResource);
  assert.equal(typeof ordinary.hooks.preStart, 'function');
  assert.equal(development.packagerConfig.extraResource.length, 1);
  assert.equal(development.packagerConfig.name, 'ModelLoom Development');
});
