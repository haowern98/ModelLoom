import { expect, test } from '@playwright/test';

test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'API', exact: true }).click();
});

test('API exposes four sections while server and credentials stay unavailable', async ({
  page,
}) => {
  for (const name of ['Server', 'Access', 'Integration', 'Runtime logs']) {
    await expect(page.getByRole('region', { name, exact: true })).toBeAttached();
  }
  await expect(page.getByText('No API server is running.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start server', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Network', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Local only', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  for (const name of [
    'Copy endpoint',
    'Reveal API key',
    'Copy API key',
    'Generate key',
    'Copy runtime logs',
    'Clear runtime logs',
  ]) {
    await expect(page.getByRole('button', { name, exact: true })).toBeDisabled();
  }
  await expect(page.getByRole('group', { name: 'API key status', exact: true })).toHaveText(
    'Unavailable',
  );
  await expect(page.getByRole('log', { name: 'Runtime log viewer' })).toContainText(
    'Waiting for runtime events.',
  );
  await expect(page.getByRole('button', { name: 'All', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Errors', exact: true }).click();
  await expect(page.getByRole('log', { name: 'Runtime log viewer' })).toContainText('No errors.');
  await expect(page.getByText('Qwen3.8-27B (demo)', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Choose in Cluster' }).click();
  await expect(page.getByRole('heading', { name: 'Cluster', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stop model' })).toBeVisible();
});

test('example tabs support keyboard selection and copy only their displayed placeholder text', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const panel = page.getByRole('tabpanel', { name: 'Python', exact: true });
  await expect(panel).toContainText('YOUR_API_KEY');
  await expect(panel).toContainText('YOUR_MODEL_ID');
  await page.getByRole('tab', { name: 'Python', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'cURL', exact: true })).toBeFocused();
  await expect(page.getByRole('tab', { name: 'cURL', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const code = await page.getByRole('tabpanel', { name: 'cURL', exact: true }).innerText();
  await page.getByRole('button', { name: 'Copy example' }).click();
  await expect(page.getByRole('status')).toHaveText('Example copied');
  expect((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n')).toBe(
    code,
  );
  await page.getByRole('tab', { name: 'cURL', exact: true }).focus();
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: 'OpenAI SDK', exact: true })).toBeFocused();
  await expect(page.getByRole('tabpanel', { name: 'OpenAI SDK', exact: true })).toContainText(
    'YOUR_API_KEY',
  );
  await page.keyboard.press('Home');
  await expect(page.getByRole('tab', { name: 'Python', exact: true })).toBeFocused();
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error('Unavailable')) },
    });
    document.execCommand = () => false;
  });
  await page.getByRole('button', { name: 'Copy example' }).click();
  await expect(page.getByRole('status')).toContainText('Could not copy');
  await expect(page.getByRole('button', { name: 'Copy example' })).toBeFocused();
});

test('API matches configuration geometry and scroll margins at desktop widths', async ({
  page,
}) => {
  const main = page.getByRole('main');
  const api = page.getByRole('region', { name: 'API', exact: true });
  for (const font of ['system', 'Arial']) {
    if (font === 'Arial')
      await page.addStyleTag({ content: ':root { font-family: Arial, sans-serif; }' });
    for (const width of [1440, 1280, 1000]) {
      await page.setViewportSize({ width, height: 720 });
      await main.evaluate((node) => {
        node.scrollTop = 0;
      });
      const bounds = await api.boundingBox();
      expect(bounds?.width).toBe(800);
      const cards = await api.locator('section > div').all();
      expect(cards).toHaveLength(4);
      let previousBottom = 0;
      for (const card of cards) {
        const box = await card.boundingBox();
        if (!box || !bounds) throw new Error('Missing API geometry');
        expect(box.x).toBe(bounds.x);
        expect(box.width).toBe(bounds.width);
        expect(box.y).toBeGreaterThan(previousBottom);
        previousBottom = box.y + box.height;
        await expect(card).toHaveCSS('background-color', 'rgb(34, 34, 34)');
        await expect(card).toHaveCSS('border-radius', '16px');
      }
      const track = await main.evaluate((node) => {
        const style = getComputedStyle(node, '::-webkit-scrollbar-track');
        return {
          top: style.marginTop,
          bottom: style.marginBottom,
          overflow: node.scrollWidth > node.clientWidth,
        };
      });
      await expect(main).toHaveCSS('scrollbar-width', 'thin');
      expect(track).toEqual({ top: '0px', bottom: '0px', overflow: false });
      await page
        .getByRole('heading', { name: 'Runtime logs', exact: true })
        .scrollIntoViewIfNeeded();
      await expect(
        page.getByRole('region', { name: 'Runtime logs', exact: true }),
      ).toBeInViewport();
      await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeInViewport();
      await main.evaluate((node) => {
        node.scrollTop = 0;
      });
      await page.screenshot({ path: `test-results/api-${font}-${width}.png` });
    }
  }
  await page.getByRole('button', { name: 'Models', exact: true }).click();
  await page.getByRole('button', { name: 'Configure Qwen3.8-27B' }).click();
  const configuration = page
    .getByRole('heading', { name: 'Model configuration' })
    .locator('xpath=ancestor::header/..');
  expect((await configuration.boundingBox())?.width).toBe(800);
  await expect(configuration).toHaveCSS('margin-top', '24px');
});
