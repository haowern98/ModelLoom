import { _electron as electron, expect, test } from '@playwright/test';
import path from 'node:path';

test('packaged demo opens safely, navigates, and exits its owned app', async ({}, testInfo) => {
  const electronApp = await electron.launch({
    args: [`--user-data-dir=${testInfo.outputPath('profile')}`],
    executablePath: path.resolve(__dirname, '../out/ModelLoom-win32-x64/ModelLoom.exe'),
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' },
  });
  const ownedProcess = electronApp.process();
  try {
    const window = await electronApp.firstWindow();
    const errors: string[] = [];
    window.on('pageerror', (error) => errors.push(error.message));
    await expect(window.getByRole('heading', { name: 'Model library', exact: true })).toBeVisible();
    await expect(window.getByText('Demo data')).toBeVisible();
    await expect(window.getByRole('button', { name: /Show grid view|Show list view/ })).toHaveCount(
      0,
    );
    for (const name of ['Import GGUF', 'Explore models']) {
      const action = window.getByRole('button', { name, exact: true });
      await expect(action).toHaveText('');
      await expect(action).toHaveCSS('border-radius', '50%');
      await expect(action).toHaveCSS('border-width', '0px');
      await expect(action).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      await expect(action.locator('svg')).toHaveCSS('width', '16px');
    }
    const navigation = window.getByRole('complementary', { name: 'Main navigation' });
    await expect(navigation.getByRole('button', { name: 'Models', exact: true })).toHaveCSS(
      'background-color',
      'rgb(47, 47, 47)',
    );
    await expect(navigation.getByRole('button', { name: 'Chat', exact: true })).toHaveCSS(
      'background-color',
      'rgba(0, 0, 0, 0)',
    );
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
    await expect(window.getByRole('article')).toHaveCount(5);
    await expect(window.getByRole('button', { name: /Start|Stop|Open in Cluster/ })).toHaveCount(0);
    await expect(window.getByLabel('Last used: unknown')).toHaveCount(5);
    await window.getByRole('button', { name: 'Configure Qwen3.8-27B' }).click();
    await expect(window.getByRole('heading', { name: 'Model configuration' })).toBeVisible();
    await expect(window.getByRole('region', { name: 'Prompt', exact: true })).toBeVisible();
    await window.getByRole('spinbutton', { name: 'Temperature', exact: true }).fill('0.6');
    await window.getByRole('button', { name: 'Save changes' }).click();
    await expect(window.getByRole('status')).toContainText('Defaults saved for this demo session');
    await window.getByRole('button', { name: 'Back to Models' }).click();
    await window.getByRole('button', { name: 'Configure Qwen3.8-27B' }).click();
    await expect(window.getByRole('spinbutton', { name: 'Temperature', exact: true })).toHaveValue(
      '0.6',
    );
    await window.getByRole('button', { name: 'Back to Models' }).click();
    await window.getByRole('button', { name: 'Cluster', exact: true }).click();
    const clusterNavigation = navigation.getByRole('button', { name: 'Cluster', exact: true });
    await expect(clusterNavigation).toHaveCSS('color', 'rgb(255, 255, 255)');
    await expect(clusterNavigation).toHaveCSS('box-shadow', 'none');
    await expect(clusterNavigation.locator('svg')).toHaveCSS('width', '20px');
    const save = window.getByRole('button', { name: 'Save changes' });
    await expect(save).toHaveCount(0);
    await expect(window.getByRole('article')).toHaveCount(4);
    await expect(window.getByText('Demo data')).toBeVisible();
    await expect(window.getByLabel('Cluster sample summary')).toHaveCount(0);
    await expect(window.getByText(/Hardware, links, and layer ranges are samples/)).toHaveCount(0);
    await expect(
      window.getByRole('button', { name: 'Selected demo model: Qwen3.8-27B' }),
    ).toHaveText('Qwen3.8-27B');
    await window.getByRole('button', { name: 'Cluster panel', exact: true }).click();
    await expect(window.getByRole('complementary', { name: 'Cluster panel' })).toBeVisible();
    await expect(window.getByRole('heading', { name: 'Cluster overview' })).toBeVisible();
    const clusterPages = window.getByRole('navigation', { name: 'Cluster navigation' });
    await clusterPages.getByRole('button', { name: /^Connections/u }).click();
    await expect(window.getByRole('tab')).toHaveCount(2);
    await expect(window.getByRole('tab', { name: 'Join cluster' })).toHaveCount(0);
    const shareTab = window.getByRole('tab', { name: 'Share this PC', exact: true });
    await shareTab.click();
    const sharePage = window.getByRole('tabpanel', { name: 'Share this PC', exact: true });
    await sharePage
      .getByRole('button', { name: 'Approve invitation from render-coordinator' })
      .click();
    await expect(window.getByLabel('1 pending request')).toBeVisible();
    await sharePage.getByRole('button', { name: 'Decline invitation from office-pc' }).click();
    await expect(window.getByLabel(/pending requests?$/)).toHaveCount(0);
    await expect(sharePage.getByText('Approved \u00b7 demo', { exact: true })).toBeVisible();
    await expect(sharePage.getByText('Declined \u00b7 demo', { exact: true })).toBeVisible();
    await window.getByRole('tab', { name: 'Add device', exact: true }).click();
    const addPage = window.getByRole('tabpanel', { name: 'Add device', exact: true });
    await addPage.getByRole('button', { name: 'Invite office-pc' }).click();
    await expect(
      addPage.getByRole('button', { name: 'Invitation pending for office-pc' }),
    ).toBeDisabled();
    await addPage.getByRole('textbox', { name: 'Private address' }).fill('192.168.1.42');
    await addPage.getByRole('button', { name: 'Invite private address' }).click();
    await expect(addPage.getByRole('status')).toHaveText('Invitation pending \u00b7 demo');
    await shareTab.click();
    const sharing = sharePage.getByRole('switch', { name: 'Allow connections' });
    await expect(sharing).not.toBeChecked();
    await sharing.click();
    await expect(sharing).toBeChecked();
    const sharedGpu = sharePage.getByRole('checkbox', { name: 'GPU', exact: true });
    await expect(sharedGpu).toBeChecked();
    await expect(sharedGpu).toBeEnabled();
    await sharing.click();
    await expect(sharing).not.toBeChecked();
    await expect(sharing).toBeFocused();
    await expect(sharedGpu).toBeDisabled();
    await clusterPages.getByRole('button', { name: 'Overview', exact: true }).click();
    await expect(window.getByRole('article')).toHaveCount(4);
    await expect(window.getByRole('button', { name: /^Edit layers for / })).toHaveCount(5);
    const editPrimary = window.getByRole('button', {
      name: 'Edit layers for studio-desktop GPU 0',
    });
    const done = window.getByRole('button', { name: 'Done', exact: true });
    await editPrimary.click();
    const first = window.getByRole('textbox', { name: 'First layer for studio-desktop GPU 0' });
    const last = window.getByRole('textbox', { name: 'Last layer for studio-desktop GPU 0' });
    await first.fill('');
    await last.fill('');
    await done.click();
    await expect(window.getByRole('button', { name: /Keep draft|Save changes/ })).toHaveCount(0);
    await window.getByRole('button', { name: 'Apply and restart' }).click();
    await expect(window.getByRole('alert')).toContainText('cover all 128 sample layers');
    await window.getByRole('button', { name: 'Dismiss notification' }).click();
    await window.getByRole('button', { name: 'Undo', exact: true }).click();
    await editPrimary.click();
    await last.fill('26');
    await done.click();
    await window.getByRole('button', { name: 'Apply and restart' }).click();
    await window
      .getByRole('dialog', { name: 'Restart demo model?' })
      .getByRole('button', { name: 'Cancel', exact: true })
      .click();
    await expect(window.getByRole('img', { name: 'GPU in use' })).toHaveCount(5);
    await window.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(window.getByRole('button', { name: 'Unload model' })).toBeVisible();
    await window.getByRole('button', { name: 'Fit to view', exact: true }).click();
    await window.getByRole('button', { name: 'Actions for ml-workstation' }).click();
    await window.getByRole('menuitem', { name: 'Rename device' }).click();
    const rename = window.getByRole('dialog', { name: 'Rename device' });
    await expect(rename.getByRole('textbox', { name: 'Device name' })).toBeFocused();
    await rename.getByRole('textbox', { name: 'Device name' }).fill('office-workstation');
    await rename.getByRole('button', { name: 'Save name' }).click();
    await expect(window.getByRole('article', { name: 'office-workstation' })).toBeVisible();
    await expect(window.getByRole('button', { name: 'Save changes' })).toHaveCount(0);
    await window.screenshot({ path: 'test-results/cluster-packaged-windows.png' });
    await window.getByRole('button', { name: 'Selected demo model: Qwen3.8-27B' }).click();
    await window.getByRole('menuitem', { name: /Llama 3.1 8B/ }).click();
    await window.getByRole('button', { name: 'Place manually', exact: true }).click();
    const range = window.getByRole('button', { name: 'Edit layers for inference-node GPU 0' });
    await range.click();
    await window.getByRole('textbox', { name: 'First layer for inference-node GPU 0' }).fill('0');
    await window.getByRole('textbox', { name: 'Last layer for inference-node GPU 0' }).fill('31');
    await done.click();
    await window.getByRole('button', { name: 'Load model' }).click();
    await window.getByRole('button', { name: 'Switch and run demo' }).click();
    await expect(window.getByRole('button', { name: 'Cancel loading' })).toBeVisible();
    await expect(window.getByRole('button', { name: 'Unload model' })).toBeVisible();
    await expect(range).toHaveText('0–31');
    await navigation.getByRole('button', { name: 'Chat', exact: true }).click();
    await expect(window.getByRole('heading', { name: 'Planning a local setup' })).toBeVisible();
    const divider = await window
      .getByRole('complementary', { name: 'Conversations' })
      .evaluate((element) => ({
        width: parseFloat(getComputedStyle(element).borderRightWidth),
        scale: devicePixelRatio,
      }));
    // Fractional Windows scaling quantizes the CSS hairline into whole device pixels.
    expect(Math.round(divider.width * divider.scale)).toBe(Math.max(1, Math.floor(divider.scale)));
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.focus());
    await expect.poll(() => window.evaluate(() => document.hasFocus())).toBe(true);
    await window.getByRole('button', { name: 'Copy response 2' }).click();
    await expect(window.getByRole('status')).toHaveText('Response copied');
    const response = await window
      .getByRole('article', { name: 'Assistant response 2' })
      .locator('p')
      .allTextContents();
    const copied = await electronApp.evaluate(({ clipboard }) => clipboard.readText());
    expect(copied.replace(/\r\n/g, '\n')).toBe(response.join('\n\n'));
    await window
      .getByRole('textbox', { name: 'Message', exact: true })
      .fill('Native preview draft');
    await expect(window.getByRole('button', { name: 'Send message' })).toBeDisabled();
    await window.getByRole('button', { name: 'Models', exact: true }).click();
    await navigation.getByRole('button', { name: 'Chat', exact: true }).click();
    await expect(window.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue(
      'Native preview draft',
    );
    await expect(window.getByRole('button', { name: 'Chat model: Llama 3.1 8B' })).toBeVisible();
    await window.screenshot({ path: 'test-results/chat-packaged-windows.png' });
    await navigation.getByRole('button', { name: 'API', exact: true }).click();
    await expect(navigation.getByRole('button', { name: 'API', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(window.getByRole('heading', { name: 'API', exact: true })).toBeVisible();
    await expect(window.getByRole('button', { name: 'Start server', exact: true })).toBeDisabled();
    await expect(window.getByRole('region', { name: 'Runtime logs', exact: true })).toBeAttached();
    await expect(window.getByText('No API server is running.')).toBeVisible();
    await window.getByRole('button', { name: 'Models', exact: true }).click();
    await window.screenshot({ path: 'test-results/models-packaged-windows.png' });
    expect(errors).toEqual([]);
  } finally {
    await electronApp.close();
  }
  expect(ownedProcess.exitCode).toBe(0);
});
