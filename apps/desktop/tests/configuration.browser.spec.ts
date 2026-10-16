import { expect, test } from '@playwright/test';

test('larger model toggles preserve all other text and control geometry', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Configure Qwen3.8-27B' }).click();
  const config = page.locator('form');
  const toggles = config.getByRole('switch');
  for (const width of [1280, 1000]) {
    await page.setViewportSize({ width, height: 720 });
    const measure = () =>
      config.evaluate((element) => ({
        fixed: Array.from(
          element.querySelectorAll(
            'h1, h2, label, p, button, input:not([role="switch"]), select, textarea',
          ),
        ).map((node) => {
          const box = node.getBoundingClientRect(),
            style = getComputedStyle(node);
          return { x: box.x, y: box.y, width: box.width, height: box.height, font: style.fontSize };
        }),
        switches: Array.from(element.querySelectorAll('[role="switch"]')).map((node) => {
          const box = node.getBoundingClientRect();
          return { right: box.right, centerY: box.y + box.height / 2 };
        }),
      }));
    await toggles.evaluateAll((nodes) =>
      nodes.forEach((node) => {
        (node as HTMLElement).style.setProperty('--control-width-switch', '28px');
        (node as HTMLElement).style.setProperty('--control-height-switch', '16px');
        (node as HTMLElement).style.setProperty('--control-size-switch-thumb', '12px');
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
    }
    expect(await measure()).toEqual(before);
  }
});

test('per-model defaults save for this session, preserve pending edits and reset after reload', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Configure Qwen3.8-27B' }).click();
  const temperature = page.getByRole('spinbutton', { name: 'Temperature', exact: true });
  await temperature.fill('0.65');
  await page.getByRole('textbox', { name: 'System Prompt' }).fill('Keep answers concise.');
  await page.getByRole('button', { name: 'Save defaults' }).click();
  await expect(page.getByRole('status')).toContainText('Defaults saved for this demo session');
  await page.getByRole('button', { name: 'Back to Models' }).click();
  await expect(page.getByRole('button', { name: 'Configure Qwen3.8-27B' })).toBeFocused();
  await page.getByRole('button', { name: 'Configure Llama 3.1 8B' }).click();
  await expect(temperature).toHaveValue('0.8');
  await expect(page.getByRole('textbox', { name: 'System Prompt' })).toHaveValue('');
  await page.getByRole('button', { name: 'Back to Models' }).click();
  await page.getByRole('button', { name: 'Configure Qwen3.8-27B' }).click();
  await expect(temperature).toHaveValue('0.65');
  await page.getByRole('textbox', { name: 'System Prompt' }).fill('Pending prompt');
  await page.getByRole('button', { name: 'Set in Cluster' }).click();
  await expect(page.getByRole('button', { name: 'Stop model' })).toBeVisible();
  await page.getByRole('button', { name: 'Models', exact: true }).click();
  await page.getByRole('button', { name: 'Configure Qwen3.8-27B' }).click();
  await expect(page.getByRole('textbox', { name: 'System Prompt' })).toHaveValue('Pending prompt');
  await expect(page.getByRole('status')).toContainText('Pending changes');
  await page.reload();
  await page.getByRole('button', { name: 'Configure Qwen3.8-27B' }).click();
  await expect(temperature).toHaveValue('0.8');
  await expect(page.getByRole('textbox', { name: 'System Prompt' })).toHaveValue('');
});

test('validation, toggles, sliders, exact stop strings and advanced editors work with the keyboard', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Configure Qwen3.8-27B' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Model configuration' })).toBeFocused();
  const auto = page.getByRole('switch', { name: 'Automatic Optimize Based on Hardware' });
  await auto.focus();
  await page.keyboard.press('Space');
  await page.getByRole('spinbutton', { name: 'Context Length' }).fill('4096');
  await auto.click();
  await expect(page.getByRole('textbox', { name: 'Context Length' })).toHaveValue('Auto');
  await auto.click();
  await expect(page.getByRole('spinbutton', { name: 'Context Length' })).toHaveValue('4096');
  const temperature = page.getByRole('spinbutton', { name: 'Temperature', exact: true });
  await temperature.fill('3');
  await page.getByRole('button', { name: 'Save defaults' }).click();
  await expect(temperature).toBeFocused();
  await expect(temperature).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('alert')).toContainText('Check the highlighted settings');
  await temperature.fill('0.5');
  const slider = page.getByRole('slider', { name: 'Temperature slider' });
  await slider.focus();
  await page.keyboard.press('ArrowRight');
  await expect(temperature).toHaveValue('0.51');
  const physical = page.getByRole('spinbutton', { name: 'Physical Batch Size' });
  await physical.fill('4096');
  await page.getByRole('button', { name: 'Save defaults' }).click();
  await expect(physical).toBeFocused();
  await expect(
    page.getByText('Physical Batch Size must not exceed Evaluation Batch Size.'),
  ).toBeVisible();
  await physical.fill('512');
  await page.getByRole('textbox', { name: 'Stop Strings' }).fill(' END ');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /Remove stop string.*END/ })).toBeVisible();
  await page.getByRole('switch', { name: 'Enable Thinking' }).click();
  await expect(
    page.getByRole('spinbutton', { name: 'Reasoning Budget', exact: true }),
  ).toBeDisabled();
  await page.getByRole('switch', { name: 'Enable Thinking' }).click();
  await expect(page.getByRole('combobox', { name: 'Method' })).toBeDisabled();
  await expect(page.getByRole('combobox', { name: /draft model/i })).toHaveCount(0);
  await page.getByText('Chat Template', { exact: true }).click();
  await page.getByRole('textbox', { name: 'Chat Template text' }).fill('<script>example</script>');
  await page.getByRole('switch', { name: 'llama.cpp Arguments Override' }).click();
  await page.getByRole('textbox', { name: 'Arguments', exact: true }).fill('--example $(ignored)');
  await page.getByRole('button', { name: 'Save defaults' }).click();
  await expect(page.getByRole('status')).toContainText('Defaults saved');
  await page.getByRole('button', { name: 'Reset defaults' }).click();
  await expect(temperature).toHaveValue('0.8');
  await expect(page.getByRole('button', { name: /Remove stop string/ })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Arguments', exact: true })).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('Pending changes');
});

for (const font of ['system', 'Arial fallback']) {
  test(`configuration uses shared typography, one column and neutral controls (${font})`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');
    if (font === 'Arial fallback')
      await page.addStyleTag({ content: ':root { font-family: Arial, sans-serif; }' });
    await page.getByRole('button', { name: 'Configure Qwen3.8-27B' }).click();
    for (const width of [1280, 1000, 800]) {
      await page.setViewportSize({ width, height: 720 });
      const heading = page.getByRole('heading', { name: 'Model configuration' });
      await page.locator('main').evaluate((main) => main.scrollTo({ top: 0 }));
      const topSpace = await heading.evaluate(
        (element) =>
          element.getBoundingClientRect().top -
          element.closest('main')!.getBoundingClientRect().top,
      );
      expect(topSpace).toBeGreaterThanOrEqual(width === 800 ? 16 : 44);
      await expect(heading).toHaveCSS('font-size', '24px');
      await expect(page.getByRole('heading', { name: 'Prompt', exact: true })).toHaveCSS(
        'font-size',
        '16px',
      );
      const config = page.locator('form');
      await expect(config.getByRole('region')).toHaveCount(6);
      await expect(config.locator('aside')).toHaveCount(0);
      await expect(heading.locator('..').locator('svg')).toHaveCount(0);
      await expect(page.getByRole('button', { name: /Run|Play|Stop model/ })).toHaveCount(0);
      const context = page.getByRole('region', { name: 'Context and Performance', exact: true });
      const auto = context.getByRole('switch', { name: 'Automatic Optimize Based on Hardware' });
      await auto.scrollIntoViewIfNeeded();
      await expect(auto).toHaveCSS('background-color', 'rgb(72, 127, 255)');
      const slider = page.getByRole('slider', { name: 'CPU Thread Pool Size slider' });
      // Chromium does not expose native range-thumb computed styles; inspect their captures.
      await expect(slider).toHaveCSS('background-image', /rgb\(255, 255, 255\)/);
      await expect(
        page.getByRole('spinbutton', { name: 'CPU Thread Pool Size', exact: true }),
      ).toHaveCSS('height', '28px');
      await expect(
        page.getByRole('spinbutton', { name: 'CPU Thread Pool Size', exact: true }),
      ).toHaveCSS('font-size', '13px');
      for (const name of ['Stop Strings', 'Reasoning Budget Message'])
        await expect(page.getByRole('textbox', { name, exact: true })).toHaveCSS(
          'width',
          width === 800 ? '244px' : '304px',
        );
      const bounds = await config.getByRole('region').evaluateAll((sections) =>
        sections.map((section) => ({
          left: section.getBoundingClientRect().left,
          right: section.getBoundingClientRect().right,
        })),
      );
      for (const box of bounds) {
        expect(box.left).toBe(bounds[0]!.left);
        expect(box.right).toBe(bounds[0]!.right);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      for (const control of await config.locator('input, select, textarea').all()) {
        const box = await control.boundingBox();
        if (box) {
          expect(box.x).toBeGreaterThanOrEqual(bounds[0]!.left);
          expect(box.x + box.width).toBeLessThanOrEqual(bounds[0]!.right);
        }
      }
      await page.locator('main').evaluate((main) => main.scrollTo({ top: 0 }));
      if (font === 'system')
        await page.screenshot({ path: `test-results/configuration-${width}.png` });
    }
    expect(errors).toEqual([]);
  });
}
