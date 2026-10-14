import type { ownershipBinding } from '../../../packages/core/src/hosts/windows-ownership';
import { _electron as electron, expect, test } from '@playwright/test';
import path from 'node:path';
import { writeFileSync } from 'node:fs';
import { developmentPackage, packagedEvidence } from './packaged-runtime-paths';

test.skip(
  process.env.MODELLOOM_PACKAGED_RUNTIME_TEST !== '1',
  'Requires the development package and harmless native fixture.',
);

test('packaged ownership escalates a synthetic hang while preserving an independent deployment', async () => {
  test.setTimeout(30_000);
  const app = await electron.launch({
    executablePath: path.join(developmentPackage, 'ModelLoom Development.exe'),
    cwd: 'E:\\',
  });
  try {
    const window = await app.firstWindow();
    const result = await app.evaluate(
      async (_, paths) => {
        const loaded: unknown = process.getBuiltinModule('module').createRequire(paths.binding)(
          paths.binding,
        );
        const native = loaded as ReturnType<typeof ownershipBinding>;
        const root = native.createDeployment(),
          independentRoot = native.createDeployment();
        const hung = native.launchConsole(root, paths.helper, [paths.fixture, 'hang'], paths.temp);
        const independent = native.launchConsole(
          independentRoot,
          paths.helper,
          [paths.fixture, 'ready'],
          paths.temp,
        );
        const pause = () => new Promise((resolve) => setTimeout(resolve, 10));
        const capture = async (child: object) => {
          let output = '';
          const deadline = Date.now() + 5000;
          while (Date.now() < deadline) {
            const seen = native.observe(child);
            output += seen.output;
            const receipt = /^ENGINE ([1-9][0-9]*)\r?\n/.exec(output);
            if (receipt && output.includes('READY HIDDEN')) {
              native.captureServer(child, Number(receipt[1]), paths.fixture);
              return;
            }
            await pause();
          }
          throw new Error('NO_OWNED_READY_RECEIPT');
        };
        const waitExit = async (child: object) => {
          const deadline = Date.now() + 2000;
          let output = '';
          while (Date.now() < deadline) {
            const seen = native.observe(child);
            output += seen.output;
            if (seen.exitCode !== -1 && seen.activeProcesses === 0) {
              native.release(child);
              return { code: seen.exitCode, cleanup: output.includes('CLEANUP') };
            }
            await pause();
          }
          throw new Error('OWNED_EXIT_NOT_CONFIRMED');
        };
        try {
          await capture(hung);
          await capture(independent);
          const began = Date.now();
          native.requestStop(hung);
          while (Date.now() - began < 5000) await pause();
          const stillHung = native.observe(hung).activeProcesses > 0;
          native.forceStop(hung);
          await waitExit(hung);
          const milliseconds = Date.now() - began;
          const independentAlive = native.observe(independent).exitCode === -1;
          native.requestStop(independent);
          const graceful = await waitExit(independent);
          return { synthetic: true, stillHung, milliseconds, independentAlive, graceful };
        } finally {
          native.closeDeployment(root);
          native.closeDeployment(independentRoot);
        }
      },
      {
        binding: path.join(
          developmentPackage,
          'resources/modelloom-development/core/out/native/ownership.node',
        ),
        helper: path.join(
          developmentPackage,
          'resources/modelloom-development/bootstrap/candidate/ModelLoom-runtime-host.exe',
        ),
        fixture: path.resolve(__dirname, '../../../packages/core/out/native/console-fixture.exe'),
        temp: path.resolve(__dirname, '../out'),
      },
    );
    writeFileSync(path.join(packagedEvidence, 'synthetic-hang.json'), JSON.stringify(result));
    expect(result.stillHung).toBe(true);
    expect(result.milliseconds).toBeGreaterThanOrEqual(5000);
    expect(result.milliseconds).toBeLessThan(7000);
    expect(result.independentAlive).toBe(true);
    expect(result.graceful).toEqual({ code: 0, cleanup: true });
    await expect(window.getByText('No models imported', { exact: true })).toBeVisible();
  } finally {
    await app.close();
  }
});
