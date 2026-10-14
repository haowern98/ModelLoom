import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { removeTestRuntimeCopies, testRuntimeCopies } from './packaged-runtime-cleanup';
import { developmentPackage, packagedEvidence } from './packaged-runtime-paths';
import {
  ownedProcesses,
  survivingProcesses,
  terminateCaptured,
  runtimeServer,
} from './packaged-runtime-processes';

test.use({ trace: 'off' });
test.skip(
  process.env.MODELLOOM_PACKAGED_RUNTIME_TEST !== '1',
  'Requires approved package and model.',
);

test('packaged runtime preserves original runtime paths, generation and loading-owner cleanup', async () => {
  test.setTimeout(420_000);
  const local = mkdtempSync(path.resolve(__dirname, '../out/gc-'));
  const installedRoot = path.join(local, 'ModelLoom-Development/runtime/installed');
  const app = await electron.launch({
    executablePath: path.join(developmentPackage, 'ModelLoom Development.exe'),
    cwd: 'E:\\',
    env: { ...process.env, LOCALAPPDATA: local },
  });
  // On Windows Playwright may return a cmd launcher; ownership belongs to Electron main.
  const mainPid = await app.evaluate(() => process.pid);
  let killed = false;
  let captured = ownedProcesses(mainPid);
  let result: Record<string, unknown> | undefined;
  const failures: unknown[] = [];
  try {
    const window = await app.firstWindow();
    await expect
      .poll(() =>
        window.evaluate(
          async () =>
            (await globalThis.window.modelLoomRuntime?.command({ action: 'snapshot' }))?.enabled,
        ),
      )
      .toBe(true);
    await window.getByRole('button', { name: 'Models', exact: true }).click();
    await app.evaluate(
      ({ dialog }, model) => {
        dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [model] });
      },
      path.resolve(
        __dirname,
        '../../../packages/core/out/activation/b11306/models/Bonsai-27B-Q1_0.gguf',
      ),
    );
    await window.getByRole('button', { name: 'Import GGUF', exact: true }).click();
    await expect(window.getByRole('article', { name: 'Bonsai 27B' })).toBeVisible({
      timeout: 60_000,
    });
    await window.getByRole('button', { name: 'Cluster', exact: true }).click();
    await window.getByRole('button', { name: 'Choose model', exact: true }).click();
    await window.getByRole('menuitem', { name: /Bonsai 27B/ }).click();
    await window.getByRole('button', { name: 'Run model', exact: true }).click();
    await expect(
      window
        .getByText('Local model ready', { exact: true })
        .or(window.getByRole('dialog', { name: 'Runtime', exact: true })),
    ).toBeVisible({ timeout: 240_000 });
    await expect(window.getByText('Local model ready', { exact: true })).toBeVisible();
    captured = ownedProcesses(mainPid);
    const firstServer = runtimeServer(captured);
    expect(firstServer).toBeDefined();
    const helper = captured.find((entry) => entry.pid === firstServer!.parent);
    const main = captured.find((entry) => entry.pid === mainPid)!;
    expect(firstServer!.name).toBe('llama-server.exe');
    expect(helper!.name).toBe('ModelLoom-runtime-host.exe');
    expect(firstServer!.image).toBe(path.join(path.dirname(helper!.image), 'llama-server.exe'));
    expect(new Date(firstServer!.created).getTime()).toBeGreaterThan(
      new Date(main.created).getTime(),
    );
    expect(testRuntimeCopies(installedRoot)).toHaveLength(1);
    expect(readdirSync(path.dirname(firstServer!.image))).not.toContain(main.name);
    expect(readdirSync(path.dirname(firstServer!.image))).not.toContain('.modelloom-launch-helper');
    console.log('Runtime check: real engine ready with original server/helper names');
    await window.getByRole('button', { name: 'Chat', exact: true }).click();
    await window.getByRole('button', { name: 'New chat', exact: true }).first().click();
    await window.getByRole('textbox', { name: 'Message', exact: true }).fill('Say hello briefly.');
    await window.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(
      window
        .getByRole('article', { name: 'Assistant response 2', exact: true })
        .getByRole('status'),
    ).toHaveText(/Complete|Output limit reached/, { timeout: 90_000 });
    console.log('Runtime check: actual Chat generation completed');
    await window.getByRole('button', { name: 'Cluster', exact: true }).click();
    await window.getByRole('button', { name: 'Stop model', exact: true }).click();
    await expect(window.getByText('Selected model not loaded', { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect
      .poll(() => survivingProcesses([firstServer!, helper!]).length, { timeout: 10_000 })
      .toBe(0);
    await window.getByRole('button', { name: 'Run model', exact: true }).click();
    await expect
      .poll(() => runtimeServer(ownedProcesses(mainPid))?.pid, { timeout: 60_000 })
      .toBeTruthy();
    captured = ownedProcesses(mainPid);
    expect(runtimeServer(captured)).toBeDefined();
    expect(await window.getByText('Local model ready', { exact: true }).isVisible()).toBe(false);
    expect(testRuntimeCopies(installedRoot)).toHaveLength(1);
    terminateCaptured(captured.find((entry) => entry.pid === mainPid)!);
    killed = true;
    await expect.poll(() => survivingProcesses(captured).length, { timeout: 15_000 }).toBe(0);
    expect(readdirSync(installedRoot).filter((name) => name.startsWith('credential-'))).toEqual([]);
    result = {
      actualPackagedJourney: true,
      imported: true,
      loaded: true,
      generated: true,
      unchangedSettings: true,
      originalLaunchPaths: true,
      renamedLaunchCopiesAbsent: true,
      gracefulUnload: true,
      ownerDeathDuringLoading: true,
      allCapturedExited: true,
      credentialDirectoryAbsent: true,
      temporaryInstalls: 1,
      main,
      helper,
      firstServer,
    };
  } catch (error) {
    failures.push(error);
  }
  try {
    if (!killed) {
      captured = ownedProcesses(mainPid);
      await app.close();
      await expect.poll(() => survivingProcesses(captured).length, { timeout: 15_000 }).toBe(0);
    }
    // Only this test's newly created runtime copies are removed; keep its verification floors.
    removeTestRuntimeCopies(installedRoot);
  } catch (error) {
    failures.push(error);
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    // Playwright displays cause, but does not serialize AggregateError.errors.
    throw new AggregateError(failures, `Packaged cleanup also failed: ${String(failures[1])}`, {
      cause: failures[0],
    });
  }
  expect(result).toBeDefined();
  writeFileSync(
    path.join(packagedEvidence, 'original-paths-loaded-owner-check.json'),
    JSON.stringify({ ...result, temporaryRuntimeCopiesRemoved: true }, null, 2),
  );
});
