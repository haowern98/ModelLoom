import { build } from 'vite';
import { Buffer } from 'node:buffer';
import { _electron as electron, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
/* global window -- Used only inside Playwright's isolated renderer evaluation callbacks. */
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
// Explicit development acceptance tool. This does not enable packaged production activation.
const directory = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const root = path.resolve(directory, '../..');
const evidenceDirectory = path.join(root, 'packages/core/out/activation/b11306/evidence/desktop');
await mkdir(evidenceDirectory, { recursive: true });
const model = path.join(root, 'packages/core/out/activation/b11306/models/Bonsai-27B-Q1_0.gguf');
process.chdir(directory);
await build({
  configFile: path.join(directory, 'vite.renderer.config.ts'),
  mode: 'production',
  build: { outDir: '.vite/renderer/main_window' },
});
await build({
  configFile: path.join(directory, 'vite.main.config.ts'),
  define: {
    MAIN_WINDOW_VITE_DEV_SERVER_URL: 'undefined',
    MAIN_WINDOW_VITE_NAME: JSON.stringify('main_window'),
  },
  build: {
    outDir: '.vite/build',
    lib: { entry: 'src/main/index.ts', formats: ['cjs'], fileName: () => 'index.cjs' },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
await build({
  configFile: path.join(directory, 'vite.preload.config.ts'),
  build: {
    emptyOutDir: false,
    outDir: '.vite/build',
    lib: { entry: 'src/preload/index.ts', formats: ['cjs'], fileName: () => 'preload.cjs' },
  },
});
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: createRequire(import.meta.url)('electron'),
  args: [path.join(directory, '.vite/build/index.cjs')],
  env,
});
const appProcess = app.process();
appProcess.on('exit', (code, signal) => console.log(JSON.stringify({ desktopExit: code, signal })));
const scenarios = [],
  errors = [];
const began = Date.now();
const execute = promisify(execFile);
async function ownedServer() {
  // Read-only process identity; retain the exact owned path/creation time for interruption.
  const { stdout } = await execute(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      "$c = Get-NetTCPConnection -State Listen -LocalPort 18478 -ErrorAction SilentlyContinue; if ($c) {Get-CimInstance Win32_Process -Filter ('ProcessId=' + $c[0].OwningProcess) | Select-Object ProcessId,ExecutablePath,@{Name='CreationDate';Expression={$_.CreationDate.ToUniversalTime().ToString('o')}},CommandLine | ConvertTo-Json -Compress}",
    ],
    { windowsHide: true, timeout: 15000 },
  );
  const process = JSON.parse(stdout);
  if (
    !process.ExecutablePath.startsWith(
      path.join(root, 'packages/core/out/activation/b11306/installed').replaceAll('/', '\\'),
    ) ||
    !process.CommandLine.includes(model.replaceAll('/', '\\')) ||
    Date.parse(process.CreationDate) < began
  )
    throw new Error('UNEXPECTED_PROCESS');
  return process;
}
let captured, lastPage;
try {
  const page = await app.firstWindow();
  lastPage = page;
  page.on('pageerror', (error) => errors.push(error.message));
  await expect(page.getByRole('heading', { name: 'Models', exact: true })).toBeVisible();
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          window.modelLoomRuntime.command({ action: 'snapshot' }).then((v) => v.enabled),
        ),
      { timeout: 15000 },
    )
    .toBe(true);
  console.log(
    'Explicit development bridge is enabled; importing Bonsai through the existing control.',
  );
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [file] });
  }, model);
  await page.getByRole('button', { name: 'Import GGUF', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.modelLoomRuntime.command({ action: 'snapshot' }))).model
          ?.name,
      { timeout: 60000 },
    )
    .toBe('Bonsai 27B');
  scenarios.push('existing Import GGUF imports the exact model without exposing its path');
  const view = await page.evaluate(() => window.modelLoomRuntime.command({ action: 'snapshot' }));
  if (JSON.stringify(view).includes(model) || JSON.stringify(view).includes('18478'))
    throw new Error('PRIVATE_DATA_EXPOSED');
  const rejected = await page.evaluate(async () => {
    try {
      await window.modelLoomRuntime.command({ action: 'import', path: 'not-authorized' });
      return false;
    } catch {
      return true;
    }
  });
  if (!rejected) throw new Error('EXTRA_FIELD_ACCEPTED');
  scenarios.push('malformed privileged renderer fields are rejected');
  await page.getByRole('button', { name: 'Cluster', exact: true }).click();
  await page.getByRole('button', { name: 'Choose model', exact: true }).click();
  await page.getByRole('menuitem', { name: /Bonsai 27B/ }).click();
  await page.getByRole('button', { name: 'Run model', exact: true }).click();
  console.log('Run requested through the app; waiting for owned authenticated readiness.');
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.modelLoomRuntime.command({ action: 'snapshot' }))).phase,
      { timeout: 185000 },
    )
    .toMatch(/ready|failed/u);
  const loaded = await page.evaluate(() => window.modelLoomRuntime.command({ action: 'snapshot' }));
  if (loaded.phase !== 'ready') throw new Error(loaded.error ?? 'LOAD_FAILED');
  await expect(page.getByRole('button', { name: 'Stop model', exact: true })).toBeVisible({
    timeout: 185000,
  });
  captured = await ownedServer();
  console.log('Real readiness confirmed; checking Stop and reload.');
  scenarios.push('existing picker and Run control reach authenticated real-engine readiness');
  await page.screenshot({ path: path.join(evidenceDirectory, 'runtime-local-ready.png') });
  await page.getByRole('button', { name: 'Stop model', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Run model', exact: true })).toBeVisible({
    timeout: 10000,
  });
  scenarios.push('Stop returns to an unloaded state after owned exit');
  await page.getByRole('button', { name: 'Run model', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop model', exact: true })).toBeVisible({
    timeout: 185000,
  });
  captured = await ownedServer();
  console.log('Reload confirmed; interrupting this owned engine to check app recovery.');
  // Deliberately interrupt only this confirmed server using a retained Process handle. The
  // executable path and kernel start time are rechecked before Kill; never kill by name.
  const interruption = path.join(evidenceDirectory, 'interrupt-owned-runtime.ps1');
  await writeFile(
    interruption,
    'param([string]$EncodedIdentity)\n$taskIdentity = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($EncodedIdentity)) | ConvertFrom-Json\n$taskProcess = Get-Process -Id $taskIdentity.ProcessId -ErrorAction Stop\n$taskHandle = $taskProcess.Handle\nif ($taskProcess.Path -cne $taskIdentity.ExecutablePath -or [Math]::Abs(($taskProcess.StartTime.ToUniversalTime() - [DateTime]::Parse($taskIdentity.CreationDate).ToUniversalTime()).TotalMilliseconds) -gt 1) {throw "IDENTITY_CHANGED"}\n$taskProcess.Kill()\nif (!$taskProcess.WaitForExit(2000)) {throw "EXIT_TIMEOUT"}\n',
  );
  await execute(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      interruption,
      Buffer.from(JSON.stringify(captured)).toString('base64'),
    ],
    { windowsHide: true, timeout: 15000 },
  );
  await expect(page.getByRole('dialog', { name: 'Runtime', exact: true })).toBeVisible({
    timeout: 10000,
  });
  await page.getByRole('button', { name: 'Got it' }).click();
  await page.getByRole('button', { name: 'Models', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Models', exact: true })).toBeVisible();
  scenarios.push('owned native interruption is detected and the actual renderer remains usable');
  await page.getByRole('button', { name: 'Cluster', exact: true }).click();
  await page.getByRole('button', { name: 'Run model', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop model', exact: true })).toBeVisible({
    timeout: 185000,
  });
  captured = await ownedServer();
  scenarios.push('explicit app recovery reloads the same model and settings');
  console.log('Recovery confirmed; checking full Quit through window close.');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await expect.poll(() => appProcess.exitCode, { timeout: 10000 }).toBe(0);
  const { stdout } = await execute(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      'Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object LocalPort -eq 18478 | Measure-Object | Select-Object -ExpandProperty Count',
    ],
    { windowsHide: true, timeout: 15000 },
  );
  if (Number(stdout.trim()) !== 0) throw new Error('OWNED_LISTENER_REMAINS');
  scenarios.push('window X performs full Quit and removes the owned listener');
  if (errors.length) throw new Error(`Renderer errors: ${errors.join('; ')}`);
  await writeFile(
    path.join(evidenceDirectory, 'runtime-desktop.json'),
    JSON.stringify(
      { completed: true, scenarios, rendererErrors: errors, lastOwnedPid: captured.ProcessId },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ completed: true, scenarios }));
} catch (error) {
  if (lastPage && !lastPage.isClosed()) {
    await lastPage.screenshot({
      path: path.join(evidenceDirectory, 'runtime-desktop-failure.png'),
    });
    console.error((await lastPage.locator('body').innerText()).slice(-2000));
  }
  throw error;
} finally {
  if (appProcess.exitCode === null && appProcess.signalCode === null) await app.close();
}
