import { expect, test } from '@playwright/test';

test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
});

test('settings search finds category content and navigation preserves the selected page', async ({
  page,
}) => {
  const categories = page.getByRole('navigation', { name: 'Settings categories' });
  await expect(page.getByRole('heading', { name: 'Appearance', exact: true })).toBeVisible();
  await expect(categories.getByRole('button')).toHaveCount(6);
  const search = page.getByRole('searchbox', { name: 'Search settings' });
  await search.fill('MOTION');
  await expect(categories.getByRole('button')).toHaveCount(1);
  await expect(categories.getByRole('button', { name: 'Appearance', exact: true })).toBeVisible();
  await search.fill('<script>unknown</script>');
  await expect(page.getByText('No matching settings')).toBeVisible();
  await search.press('Escape');
  await expect(search).toHaveValue('');
  await categories.getByRole('button', { name: 'Runtime', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Runtime', exact: true })).toBeVisible();
  await expect(categories.getByRole('button', { name: 'Runtime', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await page.getByRole('button', { name: 'Models', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Runtime', exact: true })).toBeVisible();
  await categories.getByRole('button', { name: 'Network', exact: true }).click();
  await page.getByRole('button', { name: 'Open API settings' }).click();
  await expect(page.getByRole('heading', { name: 'API', exact: true })).toBeVisible();
});

test('settings preview exposes disabled controls and an honest runtime inventory dialog', async ({
  page,
}) => {
  for (const name of ['Light', 'Dark', 'System']) {
    await expect(page.getByRole('button', { name, exact: true })).toBeDisabled();
  }
  await expect(page.getByRole('button', { name: 'Dark', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  for (const name of ['Accent colour', 'Density']) {
    await expect(page.getByRole('combobox', { name, exact: true })).toBeDisabled();
  }
  for (const name of ['Show status', 'Show metrics', 'Reduce motion', 'Contextual help']) {
    await expect(page.getByRole('switch', { name, exact: true })).toBeDisabled();
  }
  await page
    .getByRole('navigation', { name: 'Settings categories' })
    .getByRole('button', { name: 'Runtime', exact: true })
    .click();
  await expect(page.getByRole('button', { name: 'Check for updates' })).toBeDisabled();
  await expect(page.getByRole('combobox', { name: 'GGUF runtime' })).toBeDisabled();
  const manage = page.getByRole('button', { name: 'Manage installed runtimes' });
  await manage.click();
  const dialog = page.getByRole('dialog', { name: 'Installed runtimes' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Runtime inventory is not connected');
  await expect(dialog.getByRole('button', { name: /Delete|Install|Reveal/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(manage).toBeFocused();
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
});

test('settings keeps centred readable content and independent scrolling at supported widths', async ({
  page,
}) => {
  const panel = page.getByRole('complementary', { name: 'Settings navigation' });
  const detail = page.getByRole('region', { name: 'Settings details' });
  for (const font of ['system', 'Arial']) {
    if (font === 'Arial')
      await page.addStyleTag({ content: ':root { font-family: Arial, sans-serif; }' });
    for (const width of [1462, 1280, 1000]) {
      await page.setViewportSize({ width, height: width === 1000 ? 620 : 900 });
      const column = page.getByRole('article', { name: 'Appearance settings' });
      const bounds = await column.boundingBox();
      const detailBounds = await detail.boundingBox();
      if (!bounds || !detailBounds) throw new Error('Missing Settings layout');
      const scrollWidth = await detail.evaluate((node) => node.clientWidth);
      expect(bounds.width).toBeLessThanOrEqual(728);
      const left = bounds.x - detailBounds.x;
      const right = detailBounds.x + scrollWidth - bounds.x - bounds.width;
      expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
      await expect(panel).toHaveCSS('width', '240px');
      await expect(panel).toHaveCSS('background-color', 'rgb(28, 28, 28)');
      await expect(panel).toHaveCSS('border-top-right-radius', '0px');
      await expect(detail).toHaveCSS('background-color', 'rgb(24, 24, 24)');
      await expect(panel.getByRole('button', { name: 'Appearance', exact: true })).toBeInViewport();
      await expect(panel.getByRole('button', { name: 'Appearance', exact: true })).toHaveCSS(
        'font-size',
        '14px',
      );
      await detail.evaluate((node) => {
        node.scrollTop = node.scrollHeight;
      });
      await expect(page.getByRole('switch', { name: 'Contextual help' })).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await detail.evaluate((node) => {
        node.scrollTop = 0;
      });
      await page.screenshot({ path: `test-results/settings-${font}-${width}.png` });
    }
  }
});
