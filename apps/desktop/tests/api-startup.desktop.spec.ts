import { readClientState, writeHarnessFile } from './packaged-client-state';
import { _electron as electron, expect, test } from '@playwright/test';
import { createServer } from 'node:net';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { developmentPackage, packagedEvidence } from './packaged-runtime-paths';

test.skip(
  process.env.MODELLOOM_PACKAGED_RUNTIME_TEST !== '1',
  'Requires isolated protected test key and an explicit development package.',
);

test('packaged API rejects a port conflict and starts only explicitly without a model', async () => {
  const root = packagedEvidence;
  const command = (action: string) =>
    writeHarnessFile(
      path.join(root, 'command.json'),
      JSON.stringify({ action, nonce: Date.now() }),
    );
  const conflict = createServer();
  await new Promise<void>((resolve, reject) => {
    conflict.once('error', reject);
    conflict.listen(8000, '127.0.0.1', resolve);
  });
  const app = await electron.launch({
    executablePath: path.join(developmentPackage, 'ModelLoom Development.exe'),
    cwd: 'E:\\',
  });
  try {
    const window = await app.firstWindow();
    await window.getByRole('button', { name: 'API', exact: true }).click();
    await expect(window.getByRole('button', { name: 'Start server', exact: true })).toBeEnabled({
      timeout: 10_000,
    });
    await window.getByRole('button', { name: 'Start server', exact: true }).click();
    await expect(window.getByRole('button', { name: 'Stop server', exact: true })).toHaveCount(0);
    await expect(window.getByRole('status')).toContainText(/port|start|available|failed/i);
    await new Promise<void>((resolve) => conflict.close(() => resolve()));
    await window.getByRole('button', { name: 'Start server', exact: true }).click();
    await expect(window.getByRole('button', { name: 'Stop server', exact: true })).toBeVisible();
    command('models');
    await expect
      .poll(() => readClientState(path.join(root, 'client-state.json')).kind)
      .toBe('models');
    const models = readClientState(path.join(root, 'client-state.json'));
    expect(models.status).toBe(200);
    expect(models.count).toBe(0);
    command('invalids');
    await expect
      .poll(() => readClientState(path.join(root, 'client-state.json')).kind)
      .toBe('auth-origin-host');
    const denial = readClientState(path.join(root, 'client-state.json'));
    expect(denial.statuses).toEqual([401, 403, 403]);
    command('bounds');
    await expect
      .poll(() => readClientState(path.join(root, 'client-state.json')).kind)
      .toBe('bounds');
    const bounds = readClientState(path.join(root, 'client-state.json'));
    expect(bounds.statuses).toEqual([400, 400, 413]);
    writeFileSync(
      path.join(root, 'api-startup.json'),
      JSON.stringify({ models, denial, bounds, portConflictRejected: true }),
    );
    await window.getByRole('button', { name: 'Stop server', exact: true }).click();
    await expect(window.getByRole('button', { name: 'Start server', exact: true })).toBeVisible();
  } finally {
    if (conflict.listening) await new Promise<void>((resolve) => conflict.close(() => resolve()));
    await app.close();
  }
});
