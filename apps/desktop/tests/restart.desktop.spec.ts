import { readClientState } from './packaged-client-state';
import { _electron as electron, expect, test } from '@playwright/test';
import path from 'node:path';
import { writeFileSync } from 'node:fs';
import { developmentPackage, packagedEvidence } from './packaged-runtime-paths';

test.skip(
  process.env.MODELLOOM_PACKAGED_API_CLIENT !== '1',
  'Requires the completed real-runtime journey and its isolated local client.',
);

test('packaged restart retains Chat/key/defaults without importing or starting automatically', async () => {
  test.setTimeout(120_000);
  const app = await electron.launch({
    executablePath: path.join(developmentPackage, 'ModelLoom Development.exe'),
    cwd: 'E:\\',
  });
  try {
    const window = await app.firstWindow();
    await expect(window.getByText('No models imported', { exact: true })).toBeVisible();
    await window.getByRole('button', { name: 'API', exact: true }).click();
    await expect(window.getByText('Not loaded', { exact: true })).toBeVisible();
    await expect(window.getByRole('button', { name: 'Start server', exact: true })).toBeEnabled();
    await expect(window.getByRole('button', { name: 'Regenerate key', exact: true })).toBeVisible();
    await window.getByRole('button', { name: 'Chat', exact: true }).click();
    await window
      .getByRole('button', { name: 'Reply with only the word PACKAGED.', exact: true })
      .first()
      .click();
    await expect(
      window
        .getByRole('article', { name: 'Assistant response 2', exact: true })
        .getByRole('status'),
    ).toHaveText(/Complete|Output limit reached/);
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
    await window.getByRole('button', { name: 'Configure Bonsai 27B', exact: true }).click();
    await expect(window.getByRole('spinbutton', { name: 'Temperature', exact: true })).toHaveValue(
      '0.75',
    );
    await window.getByRole('button', { name: 'Back to Models', exact: true }).click();
    await window.getByRole('button', { name: 'API', exact: true }).click();
    await window.getByRole('button', { name: 'Start server', exact: true }).click();
    await expect(window.getByRole('button', { name: 'Stop server', exact: true })).toBeVisible();
    writeFileSync(path.join(packagedEvidence, 'client-state.json'), '{}');
    writeFileSync(
      path.join(packagedEvidence, 'command.json'),
      JSON.stringify({ action: 'models', nonce: Date.now() }),
    );
    const client = () => readClientState(path.join(packagedEvidence, 'client-state.json'));
    await expect.poll(() => client().kind).toBe('models');
    expect(client().status).toBe(200);
    expect(client().count).toBe(0);
    await window.getByRole('button', { name: 'Stop server', exact: true }).click();
    writeFileSync(
      path.join(packagedEvidence, 'restart.json'),
      JSON.stringify({
        libraryEmpty: true,
        engineStopped: true,
        apiStopped: true,
        historyRetained: true,
        defaultsRecovered: true,
        existingKeyAccepted: true,
      }),
    );
  } finally {
    await app.close();
  }
});
