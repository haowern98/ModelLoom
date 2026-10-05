import { expect, test } from '@playwright/test';

test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'API', exact: true }).click();
});

test('API exposes four sections while server, credentials and logs stay unavailable', async ({
  page,
}) => {
  for (const name of ['Server', 'Access', 'Integration', 'Server logs']) {
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
    'Copy server logs',
    'Clear server logs',
  ]) {
    await expect(page.getByRole('button', { name, exact: true })).toBeDisabled();
  }
  await expect(page.getByText('No key created')).toBeAttached();
  await expect(page.getByText('No server logs yet.')).toBeAttached();
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
        // Chromium omits orientation-specific margins from pseudo-element computed styles.
        // Check the applicable live rule here; native screenshots verify the painted clearance.
        const suffix = '::-webkit-scrollbar-track:vertical';
        const rule = Array.from(document.styleSheets)
          .flatMap((sheet) => Array.from(sheet.cssRules))
          .find(
            (item): item is CSSStyleRule =>
              item instanceof CSSStyleRule &&
              item.selectorText.endsWith(suffix) &&
              node.matches(item.selectorText.slice(0, -suffix.length)),
          );
        return {
          top: rule?.style.marginBlockStart,
          bottom: rule?.style.marginBlockEnd,
          overflow: node.scrollWidth > node.clientWidth,
        };
      });
      expect(track).toEqual({ top: '40px', bottom: '40px', overflow: false });
      await page
        .getByRole('heading', { name: 'Server logs', exact: true })
        .scrollIntoViewIfNeeded();
      await expect(page.getByRole('region', { name: 'Server logs', exact: true })).toBeInViewport();
      await expect(page.getByRole('button', { name: 'More navigation' })).toBeInViewport();
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
