// @vitest-environment node
import { createRequire } from 'node:module';
import type * as ChildProcess from 'node:child_process';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const childProcess = require('node:child_process') as typeof ChildProcess;
const forge = require('../../forge.config.cjs') as { hooks?: { preStart: () => void } };
const coreRoot = path.resolve(import.meta.dirname, '../../../../packages/core');
const previousDemo = process.env.MODELLOOM_DEMO;

afterEach(() => {
  vi.restoreAllMocks();
  if (previousDemo === undefined) delete process.env.MODELLOOM_DEMO;
  else process.env.MODELLOOM_DEMO = previousDemo;
});

describe.skipIf(process.platform !== 'win32')('Windows development startup', () => {
  it('rebuilds hosts then restores the existing development policy before opening Electron', () => {
    delete process.env.MODELLOOM_DEMO;
    const run = vi.spyOn(childProcess, 'execFileSync').mockReturnValue(Buffer.alloc(0));
    expect(forge.hooks?.preStart).toBeTypeOf('function');
    forge.hooks?.preStart();
    expect(run.mock.calls.map(([executable, args]) => [executable, args])).toEqual([
      [
        process.execPath,
        [require.resolve('typescript/bin/tsc'), '-p', path.join(coreRoot, 'tsconfig.build.json')],
      ],
      [process.execPath, [path.join(coreRoot, 'scripts/build-development.mjs')]],
    ]);
  });

  it('stops startup if the host build fails instead of enabling stale output', () => {
    delete process.env.MODELLOOM_DEMO;
    const run = vi.spyOn(childProcess, 'execFileSync').mockImplementation(() => {
      throw new Error('BUILD_FAILED');
    });
    expect(forge.hooks?.preStart).toBeTypeOf('function');
    expect(() => forge.hooks?.preStart()).toThrow('BUILD_FAILED');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('keeps explicitly requested demo starts separate from live development preparation', () => {
    process.env.MODELLOOM_DEMO = '1';
    const run = vi.spyOn(childProcess, 'execFileSync').mockReturnValue(Buffer.alloc(0));
    expect(forge.hooks?.preStart).toBeTypeOf('function');
    forge.hooks?.preStart();
    expect(run).not.toHaveBeenCalled();
  });
});
