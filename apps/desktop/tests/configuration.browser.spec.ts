import { expect, test } from '@playwright/test';

test('successful saves use the green popup without moving the footer buttons', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Configure Qwen3.8-27B' }).click();
  const actions = page.getByRole('group', { name: 'Model configuration actions' });
  const reset = actions.getByRole('button', { name: 'Reset defaults', exact: true });
  const save = actions.getByRole('button', { name: 'Save changes', exact: true });
  const temperature = page.getByRole('spinbutton', { name: 'Temperature', exact: true });
  await page.clock.install();
  for (const width of [1280, 640]) {
    await page.setViewportSize({ width, height: 720 });
    await temperature.fill(width === 1280 ? '0.6' : '0.7');
    const before = { reset: await reset.boundingBox(), save: await save.boundingBox() };
    await save.click();
    const status = page.getByRole('status');
    await expect(status).toHaveText('Defaults saved for this demo session.');
    await expect(actions.getByText(/Defaults saved/)).toHaveCount(0);
    const popup = status.locator('..');
    await expect(popup).toHaveCSS('background-color', 'rgb(8, 35, 18)');
    await expect(page.getByRole('button', { name: 'Dismiss notification' })).toBeVisible();
    expect({ reset: await reset.boundingBox(), save: await save.boundingBox() }).toEqual(before);
    const paneBounds = (await page.locator('main').boundingBox())!;
    const popupBounds = (await popup.boundingBox())!;
    expect(popupBounds.y - paneBounds.y).toBe(24);
    expect(popupBounds.x + popupBounds.width / 2).toBeCloseTo(
      paneBounds.x + paneBounds.width / 2,
      1,
    );
    expect(popupBounds.x).toBeGreaterThanOrEqual(paneBounds.x);
    expect(popupBounds.x + popupBounds.width).toBeLessThanOrEqual(paneBounds.x + paneBounds.width);
    await page.mouse.move(0, 0);
    await page.clock.runFor(5001);
    await expect(status).toHaveCount(0);
  }
  await temperature.fill('0.5');
  await save.click();
  const close = page.getByRole('button', { name: 'Dismiss notification' });
  await close.focus();
  await page.clock.runFor(6000);
  await expect(page.getByRole('status')).toBeVisible();
  await close.click();
  await expect(page.getByRole('status')).toHaveCount(0);
  await expect(reset).toBeFocused();
});

test('model actions stay at the pane bottom while settings scroll above them', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Configure Qwen3.8-27B' }).click();
  const actions = page.getByRole('group', { name: 'Model configuration actions' });
  const main = page.locator('main');
  const scroll = page.locator('[data-configuration-scroll]');
  const reset = actions.getByRole('button', { name: 'Reset defaults', exact: true });
  const save = actions.getByRole('button', { name: 'Save changes', exact: true });
  for (const width of [1280, 1000, 800, 640]) {
    await page.setViewportSize({ width, height: 720 });
    await expect(actions.getByRole('button')).toHaveCount(2);
    await expect(main.locator('..')).toHaveCSS('background-color', 'rgb(24, 24, 24)');
    await expect(reset).toHaveCSS('border-radius', '999px');
    await expect(reset).toHaveCSS('background-color', 'rgb(48, 48, 48)');
    await expect(save).toBeDisabled();
    const paneBounds = (await main.boundingBox())!;
    const barBounds = (await actions.boundingBox())!;
    expect(barBounds.x).toBe(paneBounds.x);
    expect(barBounds.width).toBe(paneBounds.width);
    expect(barBounds.y + barBounds.height).toBe(paneBounds.y + paneBounds.height);
    for (const fraction of [0, 0.5, 1]) {
      await scroll.evaluate((element, fraction) => {
        element.scrollTop = fraction * (element.scrollHeight - element.clientHeight);
      }, fraction);
      expect(await actions.boundingBox()).toEqual(barBounds);
      await expect(reset).toBeInViewport();
      await expect(save).toBeInViewport();
    }
    const lastControl = page.getByLabel('Seed', { exact: true });
    await lastControl.scrollIntoViewIfNeeded();
    const lastBounds = (await lastControl.boundingBox())!;
    expect(lastBounds.y + lastBounds.height).toBeLessThanOrEqual(barBounds.y);
    const saveBounds = (await save.boundingBox())!;
    const resetBounds = (await reset.boundingBox())!;
    expect(resetBounds.x + resetBounds.width).toBeLessThan(saveBounds.x);
    expect(paneBounds.x + paneBounds.width - saveBounds.x - saveBounds.width).toBeLessThanOrEqual(
      26,
    );
  }
  const prompt = page.getByRole('textbox', { name: 'System Prompt', exact: true });
  await prompt.fill('Temporary instructions');
  await expect(save).toBeEnabled();
  await expect(page.getByText('Pending changes', { exact: true })).toHaveCount(0);
  await reset.click();
  await expect(prompt).toHaveValue('');
  await expect(save).toBeDisabled();
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.screenshot({ path: 'E:/ModelLoom-Project/plans/model-fixed-actions.png' });
});

test('model explanations appear beneath labels with the Thinking row spacing and no help icons', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Configure Qwen3.8-27B' }).click();
  const form = page.locator('form');
  await expect(form.getByRole('button', { name: /^About / })).toHaveCount(0);
  await expect(form.getByRole('tooltip')).toHaveCount(0);
  await expect(form.getByText('Total tokens available for the prompt and response.')).toBeVisible();
  for (const width of [1280, 1000]) {
    await page.setViewportSize({ width, height: 900 });
    const reference = await form
      .getByText('For supported chat templates.', { exact: true })
      .evaluate((node) => {
        const style = getComputedStyle(node);
        return {
          margin: style.marginTop,
          font: style.fontSize,
          color: style.color,
          lineHeight: style.lineHeight,
        };
      });
    expect(reference.margin).toBe('4px');
    const descriptions = form.locator('[class*="labelArea"] > p');
    expect(await descriptions.count()).toBeGreaterThan(3);
    for (const description of await descriptions.all()) {
      const layout = await description.evaluate((node) => {
        const style = getComputedStyle(node);
        const labelArea = node.parentElement!;
        const row = labelArea.parentElement!;
        const areaBounds = labelArea.getBoundingClientRect();
        const controlBounds = row.lastElementChild!.getBoundingClientRect();
        return {
          text: {
            margin: style.marginTop,
            font: style.fontSize,
            color: style.color,
            lineHeight: style.lineHeight,
          },
          paddingTop: getComputedStyle(row).paddingTop,
          paddingBottom: getComputedStyle(row).paddingBottom,
          centerDifference: Math.abs(
            areaBounds.y + areaBounds.height / 2 - controlBounds.y - controlBounds.height / 2,
          ),
        };
      });
      expect(layout.text).toEqual(reference);
      expect(layout.paddingTop).toBe('14px');
      expect(layout.paddingBottom).toBe('14px');
      expect(layout.centerDifference).toBeLessThan(1);
    }
  }
  await form
    .getByRole('region', { name: 'Generation', exact: true })
    .screenshot({ path: 'E:/ModelLoom-Project/plans/model-inline-explanations.png' });
});

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
  await page.getByRole('button', { name: 'Save changes' }).click();
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
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeEnabled();
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
  await page.getByRole('button', { name: 'Save changes' }).click();
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
  await page.getByRole('button', { name: 'Save changes' }).click();
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
  await expect(page.getByRole('switch', { name: 'llama.cpp Arguments Override' })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Arguments', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('status')).toContainText('Defaults saved');
  await page.getByRole('button', { name: 'Reset defaults' }).click();
  await expect(temperature).toHaveValue('0.8');
  await expect(page.getByRole('button', { name: /Remove stop string/ })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Arguments', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeEnabled();
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
      await page
        .locator('[data-configuration-scroll]')
        .evaluate((area) => area.scrollTo({ top: 0 }));
      const topSpace = await heading.evaluate(
        (element) =>
          element.getBoundingClientRect().top -
          element.closest('main')!.getBoundingClientRect().top,
      );
      expect(topSpace).toBeGreaterThanOrEqual(width === 800 ? 16 : 44);
      await expect(heading).toHaveCSS('font-size', '24px');
      await expect(page.getByRole('heading', { name: 'Prompt', exact: true })).toHaveCSS(
        'font-size',
        '14px',
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
        page.getByRole('spinbutton', { name: 'CPU Thread Pool Size', exact: true }).locator('..'),
      ).toHaveCSS('height', '28px');
      await expect(
        page.getByRole('spinbutton', { name: 'CPU Thread Pool Size', exact: true }).locator('..'),
      ).toHaveCSS('width', '108px');
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
      await page
        .locator('[data-configuration-scroll]')
        .evaluate((area) => area.scrollTo({ top: 0 }));
      if (font === 'system')
        await page.screenshot({ path: `test-results/configuration-${width}.png` });
    }
    expect(errors).toEqual([]);
  });
}
