import type { ownershipBinding } from '../../../packages/core/src/hosts/windows-ownership';
import { _electron as electron, expect, test } from '@playwright/test';
import path from 'node:path';
import { developmentPackage, packagedEvidence } from './packaged-runtime-paths';
import { writeFileSync } from 'node:fs';

test.skip(
  process.env.MODELLOOM_PACKAGED_RUNTIME_TEST !== '1',
  'Requires the separately built development package.',
);

test('packaged main captures a synthetic console child in its owned job', async () => {
  const packageRoot = developmentPackage;
  const app = await electron.launch({
    executablePath: path.join(packageRoot, 'ModelLoom Development.exe'),
    cwd: 'E:\\',
  });
  try {
    await app.firstWindow();
    const identity = await app.evaluate(({ app }) => ({
      name: app.getName(),
      data: app.getPath('userData'),
      session: app.getPath('sessionData'),
    }));
    expect(identity.name).toBe('ModelLoom Development');
    expect(identity.data).toBe(
      path.join(process.env.LOCALAPPDATA!, 'ModelLoom-Development/chromium'),
    );
    expect(identity.session).toBe(identity.data);
    const result = await app.evaluate(
      async (_, paths) => {
        const loaded: unknown = process.getBuiltinModule('module').createRequire(paths.binding)(
          paths.binding,
        );
        const native = loaded as ReturnType<typeof ownershipBinding>;
        const root = native.createDeployment();
        const child = native.launchConsole(
          root,
          paths.helper,
          [paths.fixture, 'ready'],
          paths.temp,
        );
        let childExited = false;
        let line = '',
          code = 'NO_RECEIPT';
        try {
          const deadline = Date.now() + 5000;
          while (Date.now() < deadline) {
            const observation = native.observe(child);
            line += observation.output;
            const receipt = /^ENGINE ([1-9][0-9]*)\r?\n/.exec(line);
            if (receipt) {
              try {
                native.captureServer(child, Number(receipt[1]), paths.fixture);
                code = 'CAPTURED';
              } catch (error) {
                code = (error as Error).message;
              }
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
        } finally {
          native.closeDeployment(root);
          const deadline = Date.now() + 2000;
          while (Date.now() < deadline) {
            const observation = native.observe(child);
            if (observation.exitCode !== -1 && observation.activeProcesses === 0) {
              native.release(child);
              childExited = true;
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
        }
        return { code, childExited };
      },
      {
        binding: path.join(
          packageRoot,
          'resources/modelloom-development/core/out/native/ownership.node',
        ),
        helper: path.join(
          packageRoot,
          'resources/modelloom-development/bootstrap/candidate/ModelLoom-runtime-host.exe',
        ),
        fixture: path.resolve(__dirname, '../../../packages/core/out/native/console-fixture.exe'),
        temp: path.resolve(__dirname, '../out'),
      },
    );
    writeFileSync(path.join(packagedEvidence, 'ownership-diagnostic.json'), JSON.stringify(result));
    expect(result.code).toBe('CAPTURED');
    expect(result.childExited).toBe(true);
  } finally {
    await app.close();
  }
});
