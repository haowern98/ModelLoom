import { _electron as electron, expect, test } from '@playwright/test';
import path from 'node:path';

test('packaged demo opens safely, navigates, and exits its owned app', async () => {
  const electronApp = await electron.launch({
    executablePath: path.resolve(__dirname, '../out/ModelLoom-win32-x64/ModelLoom.exe'),
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' },
  });
  const ownedProcess = electronApp.process();
  try {
    const window = await electronApp.firstWindow();
    const errors: string[] = [];
    window.on('pageerror', (error) => errors.push(error.message));
    await expect(window.getByRole('heading', { name: 'Models', exact: true })).toBeVisible();
    await expect(window.getByText('Demo data')).toBeVisible();
    expect(
      await window.evaluate(() => ({
        require: typeof Reflect.get(window, 'require'),
        process: typeof Reflect.get(window, 'process'),
      })),
    ).toEqual({ require: 'undefined', process: 'undefined' });
    const rendererSandboxed = await electronApp.evaluate(({ app, BrowserWindow }) => {
      const pid = BrowserWindow.getAllWindows()[0]?.webContents.getOSProcessId();
      return app.getAppMetrics().find((metric) => metric.pid === pid)?.sandboxed;
    });
    expect(rendererSandboxed).toBe(true);
    await window.getByRole('button', { name: 'Open API' }).click();
    await expect(window.getByRole('heading', { name: 'API', exact: true })).toBeVisible();
    await window.getByRole('button', { name: 'Models', exact: true }).click();
    await window.screenshot({ path: 'test-results/models-packaged-windows.png' });
    expect(errors).toEqual([]);
  } finally {
    await electronApp.close();
  }
  expect(ownedProcess.exitCode).toBe(0);
});
