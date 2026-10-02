import { expect, test } from '@playwright/test';

test('reference layout has readable cards and no horizontal clipping', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Models', exact: true })).toBeVisible();
  await expect(page.getByText('Demo data')).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(5);
  await expect(page.getByRole('article', { name: 'Gemma 2 9B' })).toBeInViewport();
  const sizes = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(sizes.scroll).toBeLessThanOrEqual(sizes.width);
  expect(errors).toEqual([]);
  await page.screenshot({ path: 'test-results/models-reference-size.png' });
});

test('native modal contains keyboard focus and Escape preserves the session', async ({ page }) => {
  await page.goto('/');
  const start = page
    .getByRole('article', { name: 'Llama 3.1 8B' })
    .getByRole('button', { name: 'Start', exact: true });
  await start.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Switch demo model?' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Tab');
  expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole('article', { name: 'Qwen3.8-27B' }).getByText('Running', { exact: true }),
  ).toBeVisible();
  await expect(start).toBeFocused();
});

test('search, grid and a smaller window remain usable', async ({ page }) => {
  await page.goto('/');
  await page.setViewportSize({ width: 1000, height: 620 });
  await page.getByRole('searchbox').fill('mistral');
  await expect(page.getByRole('article')).toHaveCount(1);
  await expect(page.getByRole('article', { name: 'Mistral 7B Instruct' })).toBeVisible();
  await page.getByRole('searchbox').fill('');
  await page.getByRole('button', { name: 'Show grid view' }).click();
  await expect(page.getByRole('button', { name: 'Show list view' })).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: 'test-results/models-small-grid.png' });
});

test('metadata stays inside its tiles across desktop widths and views', async ({ page }) => {
  await page.goto('/');
  for (const width of [1280, 1279, 1240, 1200, 1180, 1100, 1000]) {
    await page.setViewportSize({ width, height: 720 });
    for (const view of ['list', 'grid']) {
      if (view === 'grid') await page.getByRole('button', { name: 'Show grid view' }).click();
      const overflow = await page
        .locator('article > div:nth-child(2) > div')
        .evaluateAll((tiles) => {
          const clipped: string[] = [];
          for (const tile of tiles) {
            const bounds = tile.getBoundingClientRect();
            for (const text of tile.querySelectorAll('span, strong')) {
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
      expect(overflow, `${view} view at ${width}px`).toEqual([]);
    }
    await page.getByRole('button', { name: 'Show list view' }).click();
  }
});
