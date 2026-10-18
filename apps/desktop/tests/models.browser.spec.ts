import { expect, test } from '@playwright/test';

test('Models toolbar has two neutral icon actions and no view toggle', async ({ page }) => {
  await page.goto('/');
  const search = page.getByRole('searchbox', { name: 'Find model', exact: true });
  await expect(search).toHaveAttribute('placeholder', 'Find model...');
  const importButton = page.getByRole('button', { name: 'Import GGUF', exact: true });
  const explore = page.getByRole('button', { name: 'Explore models', exact: true });
  await expect(page.getByRole('button', { name: /Show grid view|Show list view/ })).toHaveCount(0);
  await page.mouse.move(500, 40);
  for (const [button, name] of [
    [importButton, 'Import GGUF'],
    [explore, 'Explore models'],
  ] as const) {
    await expect(button).toHaveText('');
    await expect(button).toHaveAttribute('title', name);
    await expect(button).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(button).toHaveCSS('border-width', '0px');
    await expect(button).toHaveCSS('border-radius', '50%');
    await expect(button).toHaveCSS('color', 'rgb(139, 139, 139)');
    await expect(button).toHaveCSS('box-shadow', 'none');
    await expect(button.locator('svg')).toHaveCSS('width', '16px');
    await expect(button.locator('svg')).toHaveCSS('height', '16px');
    await button.hover();
    await expect(button).toHaveCSS('background-color', 'rgb(47, 47, 47)');
    await page.mouse.move(500, 40);
    await expect(button).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  }
  await expect(search.locator('..')).toHaveCSS('background-color', 'rgb(26, 26, 26)');
  await expect(search.locator('..')).toHaveCSS('border-color', 'rgb(56, 56, 56)');
  for (const width of [1280, 1000]) {
    await page.setViewportSize({ width, height: width === 1000 ? 620 : 720 });
    const heading = await page.getByRole('heading', { name: 'Models', exact: true }).boundingBox();
    const nameColumn = await page.getByText('Name', { exact: true }).boundingBox();
    if (!heading || !nameColumn) throw new Error('Models heading or Name column missing');
    expect(nameColumn.x).toBeCloseTo(heading.x, 1);
    const bounds = [];
    for (const control of [search.locator('..'), importButton, explore]) {
      await expect(control).toBeInViewport();
      const box = await control.boundingBox();
      if (!box) throw new Error('Models toolbar control missing');
      expect(box.height).toBe(32);
      bounds.push(box);
    }
    for (let index = 1; index < bounds.length; index++) {
      expect(bounds[index]!.x).toBeGreaterThan(bounds[index - 1]!.x + bounds[index - 1]!.width);
      expect(bounds[index]!.y).toBe(bounds[0]!.y);
    }
    await expect(importButton).toHaveCSS('width', '32px');
    await expect(explore).toHaveCSS('width', '32px');
    await expect(search.locator('..')).toHaveCSS('border-radius', '999px');
    await page.screenshot({ path: `test-results/models-toolbar-icons-${width}.png` });
  }
  await search.fill('mistral');
  await expect(page.getByRole('article')).toHaveCount(1);
  await search.fill('');
  await importButton.click();
  await expect(page.getByRole('dialog', { name: 'GGUF import' })).toContainText(
    'No file is imported',
  );
  await page.keyboard.press('Escape');
  await expect(importButton).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(explore).toBeFocused();
  await expect(explore).toHaveCSS('outline-style', 'solid');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Model downloads' })).toContainText(
    'No files are downloaded',
  );
  await page.keyboard.press('Escape');
});

test('reference layout has readable cards and no horizontal clipping', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Models', exact: true })).toBeVisible();
  await expect(page.getByText('Demo data')).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(5);
  await expect(page.getByRole('article', { name: 'Gemma 2 9B' })).toBeInViewport();
  await expect(page.getByText('Name', { exact: true })).toBeVisible();
  await expect(page.getByText('Last used', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Last used: unknown')).toHaveCount(5);
  await expect(page.getByRole('button', { name: /Start|Stop|Open in Cluster/ })).toHaveCount(0);
  await expect(page.getByText(/^(Running|Ready|Stopped|Fully compatible)$/)).toHaveCount(0);
  await page.mouse.move(500, 40);
  const qwen = page.getByRole('article', { name: 'Qwen3.8-27B' });
  await expect(qwen).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(qwen.getByRole('group', { name: 'Metadata for Qwen3.8-27B' })).toContainText(
    '16.4 GBGGUFQ4_K_M',
  );
  await qwen.hover();
  await expect(qwen).toHaveCSS('background-color', 'rgb(33, 33, 33)');
  const rowActions = page.getByRole('button', { name: /^Configure |^Actions for/ });
  await expect(rowActions).toHaveCount(10);
  for (const button of await rowActions.all()) await expect(button).toBeVisible();
  const sizes = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(sizes.scroll).toBeLessThanOrEqual(sizes.width);
  expect(errors).toEqual([]);
  await page.screenshot({ path: 'test-results/models-reference-size.png' });
});

test('row menus and configuration explain their actions and restore keyboard focus', async ({
  page,
}) => {
  await page.goto('/');
  const actions = page.getByRole('button', { name: 'Actions for Qwen3.8-27B' });
  await actions.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Remove model entry' })).toBeDisabled();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Qwen3.8-27B' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Qwen3');
  await expect(dialog).toContainText('128K');
  await expect(dialog).toContainText('Not verified');
  await page.keyboard.press('Tab');
  expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(actions).toBeFocused();
  await actions.click();
  await page.getByRole('searchbox', { name: 'Find model' }).click();
  await expect(page.getByRole('button', { name: 'Model details', exact: true })).toHaveCount(0);
  const configure = page.getByRole('button', { name: 'Configure Llama 3.1 8B' });
  await configure.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Model configuration' })).toBeFocused();
  await page.getByRole('button', { name: 'Back to Models' }).click();
  await expect(page.getByRole('button', { name: 'Configure Llama 3.1 8B' })).toBeFocused();
  const llamaActions = page.getByRole('button', { name: 'Actions for Llama 3.1 8B' });
  await llamaActions.click();
  await page.getByRole('button', { name: 'Remove model entry' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('article', { name: 'Llama 3.1 8B' })).toBeVisible();
  await expect(llamaActions).toBeFocused();
});

test('search and the list remain usable in a smaller window', async ({ page }) => {
  await page.goto('/');
  await page.setViewportSize({ width: 1000, height: 620 });
  await page.getByRole('searchbox').fill('mistral');
  await expect(page.getByRole('article')).toHaveCount(1);
  await expect(page.getByRole('article', { name: 'Mistral 7B Instruct' })).toBeVisible();
  await page.getByRole('searchbox').fill('');
  await expect(page.getByRole('article')).toHaveCount(5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: 'test-results/models-small-list.png' });
});

for (const font of ['system', 'Arial fallback']) {
  test(`compact rows and chips stay contained across desktop widths (${font})`, async ({
    page,
  }) => {
    await page.goto('/');
    if (font === 'Arial fallback') {
      await page.addStyleTag({ content: ':root { font-family: Arial, sans-serif; }' });
    }
    for (const width of [1280, 1279, 1240, 1200, 1180, 1100, 1000]) {
      await page.setViewportSize({ width, height: 720 });
      const overflow = await page
        .getByRole('group', { name: /^Metadata for/ })
        .locator('span')
        .evaluateAll((chips) => {
          const clipped: string[] = [];
          for (const chip of chips) {
            const bounds = chip.getBoundingClientRect();
            for (const text of [chip]) {
              const range = document.createRange();
              range.selectNodeContents(text);
              const content = range.getBoundingClientRect();
              if (content.left < bounds.left + 1 || content.right > bounds.right - 1) {
                clipped.push(text.textContent ?? '');
              }
            }
          }
          return clipped;
        });
      expect(overflow, `list view at ${width}px`).toEqual([]);
      await expect(page.getByRole('group', { name: /^Metadata for/ })).toHaveCount(5);
      await expect(page.getByRole('group', { name: /^Metadata for/ }).locator('span')).toHaveCount(
        15,
      );
      for (const row of await page.getByRole('article').all()) {
        const bounds = await row.boundingBox();
        if (!bounds) throw new Error('Model row missing');
        for (const button of await row.getByRole('button').all()) {
          const action = await button.boundingBox();
          if (!action) throw new Error('Model action missing');
          expect(action.x + action.width).toBeLessThanOrEqual(bounds.x + bounds.width);
        }
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
  });
}
