import { _electron as electron, expect, test } from '@playwright/test';
import path from 'node:path';
import { writeFileSync } from 'node:fs';
import { developmentPackage, packagedEvidence } from './packaged-runtime-paths';
import { readClientState, writeHarnessFile } from './packaged-client-state';

test.use({ trace: 'off' }); // Reveal is verified without persisting a secret-bearing DOM snapshot.
test.skip(
  process.env.MODELLOOM_PACKAGED_ROTATION_TEST !== '1',
  'Requires explicit isolated test-key rotation authorization and the old-key client.',
);

test('revealed packaged key stays on one line and regeneration rejects the old client', async () => {
  const app = await electron.launch({
    executablePath: path.join(developmentPackage, 'ModelLoom Development.exe'),
    cwd: 'E:\\',
  });
  const command = (action: string) => {
    writeHarnessFile(path.join(packagedEvidence, 'client-state.json'), '{}');
    writeHarnessFile(
      path.join(packagedEvidence, 'command.json'),
      JSON.stringify({ action, nonce: Date.now() }),
    );
  };
  const client = () => readClientState(path.join(packagedEvidence, 'client-state.json'));
  try {
    const window = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.setContentSize(1000, 700),
    );
    await window.getByRole('button', { name: 'API', exact: true }).click();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.focus());
    await expect.poll(() => window.evaluate(() => document.hasFocus())).toBe(true);
    await window.getByRole('button', { name: 'Reveal API key', exact: true }).click();
    await expect(
      window
        .getByRole('group', { name: 'API key status', exact: true })
        .getByRole('button')
        .first(),
    ).toBeEnabled();
    await expect(window.getByRole('button', { name: 'Hide API key', exact: true })).toBeVisible();
    const display = await window
      .getByRole('group', { name: 'API key status', exact: true })
      .locator(':scope > span')
      .evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          whitespace: style.whiteSpace,
          overflow: style.textOverflow,
          height: element.getBoundingClientRect().height,
          lineHeight: parseFloat(style.lineHeight),
        };
      });
    await window.getByRole('button', { name: 'Start server', exact: true }).click();
    await expect(window.getByRole('button', { name: 'Hide API key', exact: true })).toHaveCount(0);
    expect(display.whitespace).toBe('nowrap');
    expect(display.overflow).toBe('ellipsis');
    expect(display.height).toBeLessThanOrEqual(display.lineHeight + 1);
    command('models');
    await expect.poll(() => client().status).toBe(200);
    await window.getByRole('button', { name: 'Regenerate key', exact: true }).click();
    await window
      .getByRole('dialog', { name: 'Generate replacement key?', exact: true })
      .getByRole('button', { name: 'Regenerate key', exact: true })
      .click();
    await expect(
      window.getByRole('dialog', { name: 'Generate replacement key?', exact: true }),
    ).toHaveCount(0);
    await expect(window.getByRole('status')).toContainText('API key created');
    command('models');
    await expect.poll(() => client().status).toBe(401);
    await window.getByRole('button', { name: 'Stop server', exact: true }).click();
    writeFileSync(
      path.join(packagedEvidence, 'key-rotation.json'),
      JSON.stringify({
        display,
        maskedOnBlur: true,
        oldKeyAcceptedBefore: true,
        oldKeyRejectedAfter: true,
      }),
    );
  } finally {
    await app.close();
  }
});
