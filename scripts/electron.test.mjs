import assert from 'node:assert/strict';
import { test } from 'node:test';
import { launchDevelopment } from './electron.mjs';
import { createRequire } from 'node:module';

test('rejects missing/alternate modes and forwarded Electron flags', () => {
  for (const args of [[], ['start'], ['dev', '--user-data-dir=elsewhere']]) {
    assert.throws(
      () => launchDevelopment(args, () => assert.fail('must not spawn')),
      /npm run electron dev/,
    );
  }
});

test('uses this checkout and preserves the profile environment without inherited alternate modes', () => {
  const previous = process.env.ELECTRON_RUN_AS_NODE;
  process.env.ELECTRON_RUN_AS_NODE = '1';
  try {
    const status = launchDevelopment(
      ['dev'],
      (executable, args, options) => {
        assert.equal(executable, process.execPath);
        assert.equal(args[1], 'start');
        assert.match(args[0], /electron-forge[\\/]cli[\\/]dist[\\/]electron-forge\.js$/);
        assert.match(options.cwd, /apps[\\/]desktop[\\/]?$/);
        assert.equal(options.env.MODELLOOM_DEV_LAUNCH, 'electron-dev');
        assert.equal(options.env.ELECTRON_RUN_AS_NODE, undefined);
        assert.equal(options.env.MODELLOOM_DEMO, undefined);
        assert.equal(options.env.APPDATA, process.env.APPDATA);
        assert.equal(options.env.LOCALAPPDATA, process.env.LOCALAPPDATA);
        assert.equal(options.stdio, 'inherit');
        return { status: 7, error: undefined };
      },
      () => {},
    );
    assert.equal(status, 7);
  } finally {
    if (previous === undefined) delete process.env.ELECTRON_RUN_AS_NODE;
    else process.env.ELECTRON_RUN_AS_NODE = previous;
  }
});

test('reports a failed process launch rather than claiming success', () => {
  assert.throws(
    () =>
      launchDevelopment(
        ['dev'],
        () => ({ error: Error('spawn failed') }),
        () => {},
      ),
    /spawn failed/,
  );
});

test('checks independent storage before starting Forge and never launches after a rejected context', () => {
  assert.throws(
    () =>
      launchDevelopment(
        ['dev'],
        () => assert.fail('must not spawn'),
        () => {
          throw Error('ModelLoom needs a normal Windows terminal');
        },
      ),
    /normal Windows terminal/,
  );
});

test('direct Forge starts fail before preparing or launching the app', () => {
  const require = createRequire(import.meta.url);
  const config = require('../apps/desktop/forge.config.cjs');
  const previous = process.env.MODELLOOM_DEV_LAUNCH;
  delete process.env.MODELLOOM_DEV_LAUNCH;
  try {
    assert.throws(() => config.hooks.preStart(), /npm run electron dev/);
  } finally {
    if (previous !== undefined) process.env.MODELLOOM_DEV_LAUNCH = previous;
  }
});
