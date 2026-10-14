import { _electron as electron, expect, test } from '@playwright/test';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { developmentPackage } from './packaged-runtime-paths';

test.skip(
  process.env.MODELLOOM_PACKAGED_RUNTIME_TEST !== '1',
  'Requires the isolated development package.',
);

test('a second development launch returns to the existing instance without another core owner', async () => {
  const executablePath = path.join(developmentPackage, 'ModelLoom Development.exe');
  const app = await electron.launch({ executablePath, cwd: 'E:\\' });
  let duplicate: ReturnType<typeof spawn> | undefined;
  try {
    const window = await app.firstWindow();
    await expect(window.getByText('No models imported', { exact: true })).toBeVisible();
    const before = await app.evaluate(
      ({ app }) => app.getAppMetrics().filter((metric) => metric.name === 'ModelLoom Core').length,
    );
    expect(before).toBe(1);
    duplicate = spawn(executablePath, [], { cwd: 'E:\\', windowsHide: true, stdio: 'ignore' });
    await expect.poll(() => duplicate?.exitCode, { timeout: 5000 }).toBe(0);
    await expect(window.getByText('No models imported', { exact: true })).toBeVisible();
    const after = await app.evaluate(
      ({ app }) => app.getAppMetrics().filter((metric) => metric.name === 'ModelLoom Core').length,
    );
    expect(after).toBe(before);
  } finally {
    if (duplicate && duplicate.exitCode === null) duplicate.kill();
    await app.close();
  }
});
