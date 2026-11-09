import { expect, test } from '@playwright/test';

test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
});

test('all Settings toggles use the larger size without moving other content', async ({ page }) => {
  const navigation = page.getByRole('navigation', { name: 'Settings categories' });
  const detail = page.getByRole('region', { name: 'Settings details' });
  let count = 0;
  for (const width of [1280, 1000]) {
    await page.setViewportSize({ width, height: 900 });
    for (const category of [
      'Appearance',
      'Runtime',
      'Network',
      'Storage',
      'Diagnostics',
      'Advanced',
    ]) {
      await navigation.getByRole('button', { name: category, exact: true }).click();
      const toggles = detail.getByRole('switch');
      count += await toggles.count();
      const measure = () =>
        detail.evaluate((element) => ({
          fixed: Array.from(
            element.querySelectorAll(
              'h1, h2, label, strong, p, button, input:not([role="switch"]), select, textarea',
            ),
          ).map((node) => {
            const box = node.getBoundingClientRect(),
              style = getComputedStyle(node);
            return {
              x: box.x,
              y: box.y,
              width: box.width,
              height: box.height,
              font: style.fontSize,
            };
          }),
          switches: Array.from(element.querySelectorAll('[role="switch"]')).map((node) => {
            const box = node.getBoundingClientRect();
            return { right: box.right, centerY: box.y + box.height / 2 };
          }),
        }));
      await toggles.evaluateAll((nodes) =>
        nodes.forEach((node) => {
          const style = (node as HTMLElement).style;
          style.setProperty('--control-width-switch', '28px');
          style.setProperty('--control-height-switch', '16px');
          style.setProperty('--control-size-switch-thumb', '12px');
        }),
      );
      const before = await measure();
      await toggles.evaluateAll((nodes) => nodes.forEach((node) => node.removeAttribute('style')));
      for (const toggle of await toggles.all()) {
        await expect(toggle).toHaveCSS('width', '32px');
        await expect(toggle).toHaveCSS('height', '20px');
        expect(await toggle.evaluate((node) => getComputedStyle(node, '::before').width)).toBe(
          '16px',
        );
        expect(await toggle.evaluate((node) => getComputedStyle(node, '::before').height)).toBe(
          '16px',
        );
        if (category === 'Appearance') await expect(toggle).toBeEnabled();
        else await expect(toggle).toBeDisabled();
      }
      expect(await measure()).toEqual(before);
    }
  }
  expect(count).toBeGreaterThan(0);
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

test('Appearance applies and persists theme and motion preferences', async ({ page }) => {
  const root = page.locator('html');
  const dark = page.getByRole('button', { name: 'Dark', exact: true });
  const light = page.getByRole('button', { name: 'Light', exact: true });
  const system = page.getByRole('button', { name: 'System', exact: true });
  const reduceMotion = page.getByRole('switch', { name: 'Reduce motion', exact: true });
  const details = page.getByRole('region', { name: 'Settings details' });

  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' });
  await expect(dark).toHaveAttribute('aria-pressed', 'true');
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await expect(details).toHaveCSS('background-color', 'rgb(17, 17, 17)');
  await expect(reduceMotion).not.toBeChecked();
  await expect(root).toHaveAttribute('data-reduce-motion', 'false');

  await light.click();
  await expect(root).toHaveAttribute('data-theme', 'light');
  await expect(root).toHaveCSS('color-scheme', 'light');
  await expect(details).toHaveCSS('background-color', 'rgb(250, 250, 250)');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(root).toHaveAttribute('data-theme', 'light');
  await system.click();
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(root).toHaveAttribute('data-theme', 'light');

  await reduceMotion.check();
  await expect(root).toHaveAttribute('data-reduce-motion', 'true');
  await expect(reduceMotion).toHaveCSS('transition-property', 'none');
  await page.reload();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(system).toHaveAttribute('aria-pressed', 'true');
  await expect(root).toHaveAttribute('data-theme', 'light');
  await expect(reduceMotion).toBeChecked();
  await expect(root).toHaveAttribute('data-reduce-motion', 'true');

  await reduceMotion.uncheck();
  await expect(root).toHaveAttribute('data-reduce-motion', 'false');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(root).toHaveAttribute('data-reduce-motion', 'true');
  await expect(reduceMotion).not.toBeChecked();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(root).toHaveAttribute('data-reduce-motion', 'false');
});

test('settings exposes an honest runtime inventory dialog', async ({ page }) => {
  await page
    .getByRole('navigation', { name: 'Settings categories' })
    .getByRole('button', { name: 'Runtime', exact: true })
    .click();
  await expect(page.getByRole('button', { name: 'Check for updates' })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'GGUF runtime' })).toHaveCount(0);
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
      await expect(panel).toHaveCSS('width', '238px');
      await expect(panel).toHaveCSS('background-color', 'rgba(17, 17, 17, 0.65)');
      await expect(panel).toHaveCSS('border-top-right-radius', '0px');
      await expect(detail).toHaveCSS('background-color', 'rgb(17, 17, 17)');
      await expect(panel.getByRole('button', { name: 'Appearance', exact: true })).toBeInViewport();
      await expect(panel.getByRole('button', { name: 'Appearance', exact: true })).toHaveCSS(
        'font-size',
        '14px',
      );
      await detail.evaluate((node) => {
        node.scrollTop = node.scrollHeight;
      });
      await expect(page.getByRole('switch', { name: 'Reduce motion' })).toBeInViewport();
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

test('Settings uses native thin scrollbars across the full pane height', async ({ page }) => {
  const detail = page.getByRole('region', { name: 'Settings details' });
  const categories = page.getByRole('navigation', { name: 'Settings categories' });
  const workspace = page.getByRole('region', { name: 'ModelLoom workspace' });
  await categories.getByRole('button', { name: 'Storage', exact: true }).click();
  for (const width of [1280, 1000]) {
    await page.setViewportSize({ width, height: 620 });
    await detail.evaluate((node) => {
      node.scrollTop = 0;
    });
    await page.mouse.move(20, 20);
    for (const scroller of [categories, detail]) {
      await expect(scroller).toHaveCSS('scrollbar-width', 'thin');
      // Chromium serializes scrollbar alpha at 8-bit precision.
      await expect(scroller).toHaveCSS(
        'scrollbar-color',
        'rgba(252, 252, 252, 0.082) rgba(0, 0, 0, 0)',
      );
      expect(
        await scroller.evaluate((node) => {
          const track = getComputedStyle(node, '::-webkit-scrollbar-track');
          return [track.marginTop, track.marginBottom];
        }),
      ).toEqual(['0px', '0px']);
      await scroller.hover();
      await expect(scroller).toHaveCSS(
        'scrollbar-color',
        'rgba(252, 252, 252, 0.157) rgba(0, 0, 0, 0)',
      );
      await page.mouse.move(20, 20);
    }
    const frame = (await workspace.boundingBox())!;
    const pane = (await detail.boundingBox())!;
    expect(pane.y).toBe(frame.y);
    expect(pane.y + pane.height).toBe(frame.y + frame.height);
    await expect(detail).toHaveCSS('scrollbar-gutter', 'stable');
    await expect(detail).toHaveCSS('padding-top', '44px');
    await expect(detail).toHaveCSS('padding-bottom', '32px');
    expect(await detail.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
    await detail.focus();
    await page.keyboard.press('End');
    await expect(page.getByRole('button', { name: 'Clear unused cache' })).toBeInViewport();
    await expect
      .poll(() =>
        detail.evaluate((node) => Math.abs(node.scrollHeight - node.clientHeight - node.scrollTop)),
      )
      .toBeLessThanOrEqual(1);
    await page.screenshot({ path: test.info().outputPath(`settings-scroll-bottom-${width}.png`) });
    await page.keyboard.press('Home');
    await expect.poll(() => detail.evaluate((node) => node.scrollTop)).toBe(0);
    await expect(page.getByRole('heading', { name: 'Storage', exact: true })).toBeInViewport();
    await page.screenshot({ path: test.info().outputPath(`settings-scroll-top-${width}.png`) });
  }
});
