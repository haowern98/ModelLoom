import type { ownershipBinding } from '../../../packages/core/src/hosts/windows-ownership';
import { _electron as electron, expect, test } from '@playwright/test';
import path from 'node:path';
import { developmentPackage, packagedEvidence } from './packaged-runtime-paths';
import { writeFileSync } from 'node:fs';

test.skip(
  process.env.MODELLOOM_PACKAGED_RUNTIME_TEST !== '1',
  'Requires the verified development bundle.',
);

test('the staged approved server reports its version without loading a model', async () => {
  const packageRoot = developmentPackage;
  const evidence = packagedEvidence;
  const app = await electron.launch({
    executablePath: path.join(packageRoot, 'ModelLoom Development.exe'),
    cwd: 'E:\\',
  });
  try {
    await app.firstWindow();
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
          [paths.server, '--version'],
          paths.temp,
        );
        let code = -1,
          capture = 'NO_RECEIPT',
          output = '';
        try {
          const deadline = Date.now() + 5000;
          while (Date.now() < deadline) {
            const observation = native.observe(child);
            output += observation.output;
            const receipt = /^ENGINE ([1-9][0-9]*)\r?\n/.exec(output);
            if (receipt && capture === 'NO_RECEIPT' && observation.exitCode === -1) {
              try {
                native.captureServer(child, Number(receipt[1]), paths.server);
                capture = 'CAPTURED';
              } catch (error) {
                capture = (error as Error).message;
              }
            }
            if (observation.exitCode !== -1 && observation.activeProcesses === 0) {
              code = observation.exitCode;
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
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
        }
        return {
          code,
          capture,
          versionRecognized: output.includes('b11306') || output.includes('4f31296'),
        };
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
        server: path.join(
          packageRoot,
          'resources/modelloom-development/bootstrap/candidate/llama-server.exe',
        ),
        temp: path.resolve(__dirname, '../out'),
      },
    );
    writeFileSync(path.join(evidence, 'version-diagnostic.json'), JSON.stringify(result));
    expect(result.code).toBe(0);
    expect(result.versionRecognized).toBe(true);
  } finally {
    await app.close();
  }
});
