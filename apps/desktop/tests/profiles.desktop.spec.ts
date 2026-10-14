import { _electron as electron, expect, test } from '@playwright/test';
import path from 'node:path';
import { developmentPackage } from './packaged-runtime-paths';

test.skip(
  process.env.MODELLOOM_PACKAGE_PROFILE_TEST !== 'ordinary',
  'Requires an ordinary package, rather than the demo smoke artifact.',
);

test('ordinary package cannot gain runtime authority through developer environment', async () => {
  const app = await electron.launch({
    executablePath: path.resolve(__dirname, '../out/ModelLoom-win32-x64/ModelLoom.exe'),
    cwd: 'E:\\',
    env: {
      ...process.env,
      MODELLOOM_DEVELOPMENT_STAGE: path.join(developmentPackage, 'resources/modelloom-development'),
      MODELLOOM_DEMO: '1',
    },
  });
  try {
    const window = await app.firstWindow();
    await expect(window.getByText('No runtime connected', { exact: true })).toBeVisible();
    await window.getByRole('button', { name: 'API', exact: true }).click();
    await expect(window.getByRole('button', { name: 'Start server', exact: true })).toBeDisabled();
    await expect(window.getByRole('button', { name: 'Generate key', exact: true })).toBeDisabled();
  } finally {
    await app.close();
  }
});
