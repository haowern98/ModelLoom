import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

test('device rename supports keyboard cancellation, validation and long names without altering placement', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Cluster', exact: true }).click();
  const panel = page.getByRole('complementary', { name: 'Cluster panel' });
  const trigger = page.getByRole('button', { name: 'Actions for ml-workstation' });
  await trigger.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Rename device' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const input = panel.getByRole('textbox', { name: 'Device name' });
  const pencil = panel.getByRole('button', { name: 'Edit device name' });
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('ml-workstation');
  expect(
    await input.evaluate((element: HTMLInputElement) => [
      element.selectionStart,
      element.selectionEnd,
    ]),
  ).toEqual([0, 'ml-workstation'.length]);
  await expect(panel.getByRole('button', { name: 'Save name' })).toHaveCSS(
    'background-color',
    'rgb(255, 255, 255)',
  );
  await input.fill('cancelled');
  await page.keyboard.press('Escape');
  await expect(input).toHaveCount(0);
  await expect(panel).toBeVisible();
  await expect(pencil).toBeFocused();
  await expect(page.getByRole('article', { name: 'ml-workstation' })).toBeVisible();
  await page.mouse.move(0, 0);
  await panel.getByRole('button', { name: 'Close cluster panel' }).focus();
  await expect(pencil).toHaveCSS('opacity', '0');
  await panel.getByRole('heading', { name: 'ml-workstation' }).hover();
  await expect(pencil).toHaveCSS('opacity', '1');
  await pencil.click();
  await input.fill('   ');
  await page.keyboard.press('Enter');
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await expect(panel.getByText('Enter a device name.')).toBeVisible();
  const name = `worker-${'x'.repeat(57)}`;
  await input.fill(name);
  await page.screenshot({ path: 'test-results/cluster-rename-panel.png' });
  await page.keyboard.press('Enter');
  await expect(input).toHaveCount(0);
  await expect(pencil).toBeFocused();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('status')).toHaveText('Device renamed');
  await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(0);
  await expect(panel.getByRole('heading', { name })).toBeVisible();
  const card = page.getByRole('article', { name });
  for (const width of [1280, 1000]) {
    await page.setViewportSize({ width, height: width === 1000 ? 620 : 720 });
    await expect(page.getByRole('button', { name: `Actions for ${name}` })).toBeInViewport();
    const label = card.getByRole('button', { name: `Select ${name}` });
    await expect(label).toHaveAttribute('title', name);
    await expect(label).toHaveCSS('text-overflow', 'ellipsis');
    const cardBounds = await card.boundingBox();
    const labelBounds = await label.boundingBox();
    const panelBounds = await panel.boundingBox();
    const titleBounds = await panel.getByRole('heading', { name }).boundingBox();
    if (!cardBounds || !labelBounds || !panelBounds || !titleBounds)
      throw new Error('Renamed device geometry missing');
    expect(labelBounds.x + labelBounds.width).toBeLessThan(cardBounds.x + cardBounds.width);
    expect(titleBounds.x + titleBounds.width).toBeLessThan(panelBounds.x + panelBounds.width);
  }
  await pencil.click();
  await input.fill('unsubmitted-name');
  await page.getByRole('button', { name: 'Select mac-studio' }).click();
  await expect(input).toHaveCount(0);
  await expect(card).toBeVisible();
  await pencil.click();
  await input.fill('closed-panel-name');
  await panel.getByRole('button', { name: 'Close cluster panel' }).click();
  await page.getByRole('button', { name: 'Select mac-studio' }).click();
  await expect(input).toHaveCount(0);
  await pencil.click();
  await expect(input).toHaveValue('mac-studio');
  await panel.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Cluster overview', exact: true }).click();
  await expect(panel.getByRole('button', { name: `${name} 48–71` })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Find devices' }).fill(name);
  await expect(page.getByRole('article')).toHaveCount(1);
  await page.getByRole('button', { name: 'Models', exact: true }).click();
  await page.getByRole('button', { name: 'Cluster', exact: true }).click();
  await expect(card).toBeVisible();
});

async function editSampleProposal(page: Page) {
  await page.getByRole('button', { name: 'Select studio-desktop' }).click();
  await page.getByRole('spinbutton', { name: 'Last layer for GPU 0' }).fill('26');
  await page.getByRole('spinbutton', { name: 'First layer for GPU 1' }).fill('27');
}

async function renameSampleDevice(page: Page, name: string) {
  await page.getByRole('button', { name: 'Actions for studio-desktop' }).click();
  await page.getByRole('button', { name: 'Rename device' }).click();
  await page.getByRole('textbox', { name: 'Device name' }).fill(name);
  await page.getByRole('button', { name: 'Save name' }).click();
}

test('direct edits expose restart and quiet Discard without saved draft sections', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Cluster', exact: true }).click();
  await editSampleProposal(page);
  const panel = page.getByRole('complementary', { name: 'Cluster panel' });
  await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Keep draft/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Apply and restart' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Discard changes' })).toBeVisible();
  await expect(panel.getByText(/Unsaved draft|Saved proposal/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Close cluster panel' }).click();
  await page.getByRole('button', { name: 'Apply and restart' }).click();
  await expect(page.getByRole('dialog', { name: 'Restart demo model?' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Apply and restart' })).toBeFocused();
  await page.getByRole('button', { name: 'Select studio-desktop' }).click();
  await page.getByRole('button', { name: 'Discard changes' }).click();
  await expect(page.getByRole('spinbutton', { name: 'Last layer for GPU 0' })).toHaveValue('27');
  await expect(page.getByRole('button', { name: 'Stop model' })).toBeVisible();
});

test('toasts overlay the screen, close with X and leave placement unchanged', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Cluster', exact: true }).click();
  const card = page.getByRole('article', { name: 'studio-desktop' });
  const before = await card.boundingBox();
  await renameSampleDevice(page, 'studio-desktop');
  const toast = page.getByRole('status');
  await expect(toast).toHaveText('Device renamed');
  await expect(toast.locator('..')).toHaveCSS('background-color', 'rgb(8, 35, 18)');
  expect(await card.boundingBox()).toEqual(before);
  const bounds = await toast.locator('..').boundingBox();
  if (!bounds) throw new Error('Toast missing');
  expect(bounds.width).toBeLessThan(700);
  expect(bounds.y).toBeLessThan(100);
  await page.getByRole('button', { name: 'Dismiss notification' }).click();
  await expect(toast).toHaveCount(0);
  await editSampleProposal(page);
  await page.getByRole('button', { name: 'Discard changes' }).click();
  await expect(toast).toHaveText('Changes discarded');
  await expect(toast.locator('..')).toHaveCSS('background-color', 'rgb(38, 38, 38)');
});

test('toast timers pause on hover and keyboard focus, and replacements get a fresh timeout', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Cluster', exact: true }).click();
  await page.clock.install();
  await renameSampleDevice(page, 'studio-desktop');
  const toast = page.getByRole('status');
  await page.clock.runFor(3000);
  await toast.hover();
  await page.clock.runFor(6000);
  await expect(toast).toHaveText('Device renamed');
  await page.getByRole('button', { name: 'Dismiss notification' }).focus();
  await page.mouse.move(10, 10);
  await page.clock.runFor(6000);
  await expect(toast).toBeVisible();
  await page.getByRole('searchbox', { name: 'Find devices' }).focus();
  await page.clock.runFor(2001);
  await expect(toast).toHaveCount(0);
  await editSampleProposal(page);
  await page.getByRole('button', { name: 'Discard changes' }).click();
  await page.clock.runFor(4000);
  await renameSampleDevice(page, 'studio-desktop');
  await page.clock.runFor(2000);
  await expect(toast).toHaveText('Device renamed');
  await page.mouse.move(10, 10);
  await page.getByRole('searchbox', { name: 'Find devices' }).focus();
  await page.clock.runFor(3001);
  await expect(toast).toHaveCount(0);
});

test('red coverage toasts expire while invalid raw field explanations remain', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Cluster', exact: true }).click();
  await page.getByRole('button', { name: 'Select studio-desktop' }).click();
  await page.clock.install();
  const first = page.getByRole('spinbutton', { name: 'First layer for GPU 0' });
  await first.fill('-1');
  await page.getByRole('button', { name: 'Apply and restart' }).click();
  const toast = page.getByRole('alert');
  await expect(toast).toContainText('cover all 128 sample layers exactly once');
  await expect(toast.locator('..')).toHaveCSS('background-color', 'rgb(43, 16, 16)');
  await expect(first).toHaveAttribute('aria-invalid', 'true');
  await expect(
    page.getByRole('complementary', { name: 'Cluster panel' }).getByText(/cover all 128/),
  ).toHaveCount(0);
  await page.clock.runFor(3000);
  await page.getByRole('button', { name: 'Apply and restart' }).click();
  await page.clock.runFor(3000);
  await expect(toast).toBeVisible();
  await page.clock.runFor(2001);
  await expect(toast).toHaveCount(0);
  await expect(first).toHaveAccessibleDescription(/whole numbers/);
  await first.fill('0');
  await expect(first).not.toHaveAttribute('aria-invalid', 'true');
});

test('Cluster paints one continuous content background inside the neutral shell', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Cluster', exact: true }).click();
  const workspace = page.getByRole('region', { name: 'ModelLoom workspace' });
  await expect(workspace).toHaveCSS('background-color', 'rgb(24, 24, 24)');
  expect(
    await workspace.evaluate((element) => getComputedStyle(element.parentElement!).backgroundColor),
  ).toBe('rgb(33, 33, 33)');
  const heading = page.getByRole('heading', { name: 'Cluster', exact: true });
  expect(
    await heading.evaluate(
      (element) => getComputedStyle(element.closest('section')!).backgroundColor,
    ),
  ).toBe('rgb(24, 24, 24)');
  await page.screenshot({ path: 'test-results/cluster-continuous-background.png' });
});

test('canvas never draws an outline while keyboard controls and control focus still work', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Cluster', exact: true }).click();
  const canvas = page.getByRole('region', { name: 'Cluster canvas' });
  await canvas.focus();
  await page.keyboard.press('ArrowRight');
  await expect(canvas).toBeFocused();
  await expect(canvas).toHaveCSS('outline-style', 'none');
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('Canvas is missing');
  await page.mouse.click(bounds.x + 30, bounds.y + bounds.height - 60);
  await expect(canvas).toHaveCSS('outline-style', 'none');
  await page.mouse.down();
  await page.mouse.move(bounds.x + 70, bounds.y + bounds.height - 80);
  await expect(canvas).toHaveCSS('outline-style', 'none');
  await page.mouse.up();
  await expect(canvas).toHaveCSS('outline-style', 'none');
  const search = page.getByRole('searchbox', { name: 'Find devices' });
  await search.focus();
  await expect(search).toHaveCSS('outline-style', 'solid');
  await expect(search).toHaveCSS('outline-width', '2px');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Add', exact: true })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Add', exact: true })).toHaveCSS(
    'outline-style',
    'solid',
  );
});

test('Cluster preserves the reference composition and sample disclosure at desktop sizes', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Cluster', exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(4);
  await expect(page.getByText('Demo data', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Cluster sample summary')).toHaveCount(0);
  await expect(page.getByText(/Hardware, links, and layer ranges are samples/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Selected demo model: Qwen3.8-27B' })).toHaveText(
    'Qwen3.8-27B',
  );
  for (const font of ['system', 'Arial']) {
    if (font === 'Arial')
      await page.addStyleTag({ content: ':root { font-family: Arial, sans-serif; }' });
    for (const width of [1280, 1100, 1000]) {
      await page.setViewportSize({ width, height: width === 1000 ? 620 : 720 });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      const clipped = await page.getByRole('article').evaluateAll((cards) =>
        cards.flatMap((card) => {
          const bounds = card.getBoundingClientRect();
          // The contextual + intentionally sits outside the card; its reachability is checked below.
          return Array.from(
            card.querySelectorAll('h2, h3, p, button:not([aria-label^="Add device near"])'),
          )
            .filter((element) => {
              const content = element.getBoundingClientRect();
              return (
                content.right > bounds.right + 1 ||
                content.left < bounds.left - 1 ||
                element.scrollWidth > element.clientWidth + 1
              );
            })
            .map((element) => element.textContent);
        }),
      );
      expect(clipped, `${font} at ${width}px`).toEqual([]);
      if (width === 1280) {
        const graphBottom = await page
          .getByRole('article')
          .evaluateAll((cards) =>
            Math.max(...cards.map((card) => card.getBoundingClientRect().bottom)),
          );
        const main = await page.getByRole('main').boundingBox();
        if (!main) throw new Error('Workspace is missing');
        expect(graphBottom, `${font}: complete graph fits at 720px`).toBeLessThanOrEqual(
          main.y + main.height - 12,
        );
      }
      await expect(page.getByRole('heading', { name: 'Cluster', exact: true })).toHaveCSS(
        'font-size',
        '24px',
      );
      await expect(page.getByRole('heading', { name: 'studio-desktop', exact: true })).toHaveCSS(
        'font-size',
        '14px',
      );
    }
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.addStyleTag({
    content: ":root { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }",
  });
  await page.screenshot({ path: 'test-results/cluster-reference-desktop.png' });
});

test('direct layer edits, restart cancellation and navigation work with the keyboard', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Cluster', exact: true }).click();
  const edit = page.getByRole('button', { name: 'Edit layers for studio-desktop GPU 0' });
  await edit.focus();
  await page.keyboard.press('Enter');
  const first = page.getByRole('spinbutton', { name: 'First layer for GPU 0' });
  await first.fill('-1');
  await expect(first).toHaveAccessibleDescription(/whole numbers from 0 to 127/);
  await page.keyboard.press('Escape');
  await expect(edit).toBeFocused();
  await edit.click();
  await expect(first).toHaveValue('-1');
  await first.fill('0');
  await page.getByRole('spinbutton', { name: 'Last layer for GPU 0' }).fill('26');
  await page.getByRole('spinbutton', { name: 'First layer for GPU 1' }).fill('27');
  const restart = page.getByRole('button', { name: 'Apply and restart' });
  await restart.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Restart demo model?' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(restart).toBeFocused();
  await page.getByRole('button', { name: 'Discard changes' }).click();
  await expect(page.getByRole('button', { name: 'Stop model' })).toBeVisible();
  await page.getByRole('button', { name: 'Close cluster panel' }).click();
  await page.getByRole('searchbox', { name: 'Find devices' }).fill('192.168.1.11');
  await expect(page.getByRole('article')).toHaveCount(1);
  await page.getByRole('button', { name: 'Actions for ml-workstation' }).click();
  await page.getByRole('button', { name: 'Device details' }).click();
  await expect(page.getByRole('complementary', { name: 'Cluster panel' })).toContainText(
    'Sample device',
  );
});

test('canvas pans on left drag and zooms at the cursor without moving the panel', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Cluster', exact: true }).click();
  const canvas = page.getByRole('region', { name: 'Cluster canvas' });
  const card = page.getByRole('article', { name: 'studio-desktop' });
  await page.getByRole('button', { name: 'Cluster panel', exact: true }).click();
  const panel = page.getByRole('complementary', { name: 'Cluster panel' });
  const panelBefore = await panel.boundingBox();
  const viewport = await canvas.boundingBox();
  const before = await card.boundingBox();
  if (!viewport || !before) throw new Error('Canvas or card is missing');
  const x = viewport.x + 50;
  const y = viewport.y + viewport.height - 60;
  await page.mouse.move(x, y);
  await page.mouse.down({ button: 'left' });
  await page.mouse.move(x + 70, y - 40, { steps: 8 });
  await page.mouse.up({ button: 'left' });
  const panned = await card.boundingBox();
  if (!panned) throw new Error('Card is missing');
  expect(panned.x - before.x).toBeCloseTo(70, 0);
  expect(panned.y - before.y).toBeCloseTo(-40, 0);
  await page.mouse.move(x, y);
  await page.mouse.wheel(0, -250);
  await expect
    .poll(async () => (await card.boundingBox())?.width ?? 0)
    .toBeGreaterThan(panned.width);
  const zoomed = await card.boundingBox();
  if (!zoomed) throw new Error('Card is missing');
  expect((zoomed.x - x) / zoomed.width).toBeCloseTo((panned.x - x) / panned.width, 2);
  expect((zoomed.y - y) / zoomed.height).toBeCloseTo((panned.y - y) / panned.height, 2);
  expect(await panel.boundingBox()).toEqual(panelBefore);
  // A wheel over the scrollable inspector must never zoom the graph.
  await panel.hover();
  await page.mouse.wheel(0, -300);
  expect((await card.boundingBox())?.width).toBeCloseTo(zoomed.width, 1);
  await page.mouse.move(x, y);
  await page.mouse.wheel(0, 250);
  await expect.poll(async () => (await card.boundingBox())?.width ?? 0).toBeLessThan(zoomed.width);
  await page.screenshot({ path: 'test-results/cluster-canvas-overview.png' });
});

test('nodes select independently of role and expose the same contextual Add device flow', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Cluster', exact: true }).click();
  const coordinator = page.getByRole('article', { name: 'studio-desktop' });
  const worker = page.getByRole('article', { name: 'ml-workstation' });
  expect(await coordinator.evaluate((node) => getComputedStyle(node).borderColor)).toBe(
    await worker.evaluate((node) => getComputedStyle(node).borderColor),
  );
  await expect(page.getByRole('button', { name: 'Select studio-desktop' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  const add = page.getByRole('button', { name: 'Add device near ml-workstation' });
  await page.mouse.move(0, 0);
  await expect(add).toHaveCSS('opacity', '0');
  await worker.hover();
  await expect(add).toHaveCSS('opacity', '1');
  await add.click();
  const panel = page.getByRole('complementary', { name: 'Cluster panel' });
  await expect(panel.getByRole('heading', { name: 'Add device' })).toBeVisible();
  await expect(panel.getByText('Example devices · not discovered')).toBeVisible();
  await page.getByRole('button', { name: 'Close cluster panel' }).click();
  await page.getByRole('button', { name: 'Select ml-workstation' }).focus();
  await page.keyboard.press('Enter');
  await expect(panel.getByRole('heading', { name: 'ml-workstation' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Select ml-workstation' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('button', { name: 'Select studio-desktop' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(worker).toHaveCSS('border-color', 'rgb(171, 171, 171)');
  await page.screenshot({ path: 'test-results/cluster-canvas-device.png' });
});

test('keyboard pan, bounded zoom and fit work without zooming layer inputs', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Cluster', exact: true }).click();
  const canvas = page.getByRole('region', { name: 'Cluster canvas' });
  const card = page.getByRole('article', { name: 'studio-desktop' });
  const original = await card.boundingBox();
  if (!original) throw new Error('Card is missing');
  await canvas.focus();
  await page.keyboard.press('ArrowRight');
  expect((await card.boundingBox())?.x).toBeCloseTo(original.x + 40, 1);
  for (let index = 0; index < 12; index++) await page.keyboard.press('+');
  expect((await card.boundingBox())?.width).toBeCloseTo(original.width * 2, 1);
  await expect(page.getByRole('button', { name: 'Zoom in', exact: true })).toBeDisabled();
  for (let index = 0; index < 24; index++) await page.keyboard.press('-');
  expect((await card.boundingBox())?.width).toBeCloseTo(original.width * 0.25, 1);
  await expect(page.getByRole('button', { name: 'Zoom out', exact: true })).toBeDisabled();
  await page.keyboard.press('0');
  expect((await card.boundingBox())?.width).toBeCloseTo(original.width, 1);
  expect((await card.boundingBox())?.x).toBeCloseTo(original.x, 1);
  await page.getByRole('button', { name: 'Edit layers for studio-desktop GPU 0' }).click();
  const beforeInput = await card.boundingBox();
  const graphTransform = await canvas
    .locator('> div[style]')
    .evaluate((element) => element.style.transform);
  await page.getByRole('spinbutton', { name: 'First layer for GPU 0' }).fill('-1');
  const editedBounds = await card.boundingBox();
  // Direct editing now adds planned/active information; it must not pan or zoom the graph.
  expect(editedBounds?.x).toBe(beforeInput?.x);
  expect(editedBounds?.y).toBe(beforeInput?.y);
  expect(editedBounds?.width).toBe(beforeInput?.width);
  expect(await canvas.locator('> div[style]').evaluate((element) => element.style.transform)).toBe(
    graphTransform,
  );
  await page.getByRole('button', { name: 'Close cluster panel' }).click();
  const viewport = await canvas.boundingBox();
  if (!viewport) throw new Error('Canvas is missing');
  await page.mouse.move(viewport.x + 30, viewport.y + viewport.height - 70);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(viewport.x + 90, viewport.y + viewport.height - 90);
  await page.mouse.up({ button: 'right' });
  expect(await card.boundingBox()).toEqual(editedBounds);
});

test('the node Add shortcut stays visible with one connected device and becomes contextual with two', async ({
  page,
}) => {
  let deviceCount = 1;
  // Vary only the fixture data at its module boundary; exercise the real cards, styles and flow.
  await page.route('**/src/renderer/mocks/cluster.ts*', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: `${await response.text()}\ndemoDevices.splice(${deviceCount});\n`,
    });
  });
  for (deviceCount of [1, 2]) {
    await page.goto('/');
    await page.getByRole('button', { name: 'Cluster', exact: true }).click();
    await expect(page.getByRole('article')).toHaveCount(deviceCount);
    const add = page.getByRole('button', { name: 'Add device near studio-desktop' });
    await page.mouse.move(0, 0);
    await expect(add).toHaveCSS('opacity', deviceCount === 1 ? '1' : '0');
    await add.focus();
    await expect(add).toHaveCSS('opacity', '1');
    await page.keyboard.press('Enter');
    await expect(
      page
        .getByRole('complementary', { name: 'Cluster panel' })
        .getByRole('heading', { name: 'Add device' }),
    ).toBeVisible();
  }
});

test('Cluster toolbar uses rounded neutral controls and overlays its panel without moving cards', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Cluster', exact: true }).click();
  const toggle = page.getByRole('button', { name: 'Cluster panel', exact: true });
  const add = page.getByRole('button', { name: 'Add', exact: true });
  const search = page.getByRole('searchbox', { name: 'Find devices' });
  const panel = page.getByRole('complementary', { name: 'Cluster panel' });
  await page.mouse.move(0, 0);
  await expect(toggle).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await toggle.hover();
  await expect(toggle).toHaveCSS('background-color', 'rgb(47, 47, 47)');
  await page.mouse.move(0, 0);
  await expect(toggle).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(add).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(add).toHaveCSS('color', 'rgb(24, 24, 24)');
  const searchStyle = await search.evaluate((input) => {
    if (!input.parentElement) throw new Error('Search container is missing');
    const style = getComputedStyle(input.parentElement);
    return { radius: parseFloat(style.borderRadius), height: input.parentElement.clientHeight };
  });
  expect(searchStyle.radius).toBeGreaterThanOrEqual(searchStyle.height / 2);
  for (const width of [1280, 1000]) {
    await page.setViewportSize({ width, height: 720 });
    // ResizeObserver fits the graph on the next frame; compare only after that resize settles.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    const before = await page.getByRole('article').evaluateAll((cards) =>
      cards.map((card) => {
        const { x, y, width, height } = card.getBoundingClientRect();
        return { x, y, width, height };
      }),
    );
    const addBounds = await add.boundingBox();
    const toggleBounds = await toggle.boundingBox();
    if (!addBounds || !toggleBounds) throw new Error('Toolbar controls are missing');
    expect(toggleBounds.x).toBeGreaterThan(addBounds.x + addBounds.width);
    expect(toggleBounds.y).toBe(addBounds.y);
    await toggle.click();
    await page.mouse.move(0, 0);
    await expect(panel).toBeVisible();
    await expect(toggle).toHaveCSS('background-color', 'rgb(47, 47, 47)');
    const after = await page.getByRole('article').evaluateAll((cards) =>
      cards.map((card) => {
        const { x, y, width, height } = card.getBoundingClientRect();
        return { x, y, width, height };
      }),
    );
    expect(after).toEqual(before);
    const bounds = await panel.boundingBox();
    if (!bounds) throw new Error('Cluster panel is missing');
    expect(bounds.x + bounds.width).toBeLessThan(width);
    expect(bounds.y + bounds.height).toBeLessThan(720);
    await expect(page.getByRole('button', { name: 'Close cluster panel' })).toBeFocused();
    // The panel does not trap focus or block the underlying search.
    await search.fill('M2 Ultra');
    await expect(page.getByRole('article')).toHaveCount(1);
    await search.fill('');
    await page.getByRole('button', { name: 'Close cluster panel' }).focus();
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(toggle).toBeFocused();
    await expect(toggle).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole('heading', { name: 'Cluster', exact: true }).click();
  await page.mouse.move(0, 0);
  await page.screenshot({ path: 'test-results/cluster-toolbar-closed.png' });
  await toggle.click();
  await page.getByRole('heading', { name: 'Cluster', exact: true }).click();
  await page.mouse.move(0, 0);
  await page.screenshot({ path: 'test-results/cluster-toolbar-panel.png' });
});

test('floating canvas controls zoom and fit without moving the toolbar or inspector', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Cluster', exact: true }).click();
  const canvas = page.getByRole('region', { name: 'Cluster canvas' });
  const controls = canvas.getByRole('group', { name: 'Canvas controls' });
  const diagram = canvas.locator(':scope > div').first();
  const scale = () =>
    diagram.evaluate((element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).a);
  await expect(controls).toBeVisible();
  await expect(controls.getByRole('button', { name: 'Pan', exact: true })).toHaveCount(0);
  await expect(canvas.getByText(/Drag to pan · Scroll to zoom/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Cluster panel', exact: true }).click();
  const panel = page.getByRole('complementary', { name: 'Cluster panel' });
  const panelBounds = await panel.boundingBox();
  const barBounds = await controls.boundingBox();
  const before = await scale();
  await controls.getByRole('button', { name: 'Zoom in', exact: true }).click();
  expect(await scale()).toBeGreaterThan(before);
  expect(await controls.boundingBox()).toEqual(barBounds);
  expect(await panel.boundingBox()).toEqual(panelBounds);
  const zoomed = await scale();
  await controls.hover();
  await page.mouse.wheel(0, 300);
  expect(await scale()).toBe(zoomed);
  const percentage = await controls.getByText(/^\d+%$/).boundingBox();
  if (!percentage) throw new Error('Zoom percentage missing');
  const beforeBarDrag = await diagram.getAttribute('style');
  await page.mouse.move(percentage.x + percentage.width / 2, percentage.y + percentage.height / 2);
  await page.mouse.down();
  await page.mouse.move(percentage.x + percentage.width / 2 + 40, percentage.y - 20);
  await page.mouse.up();
  expect(await diagram.getAttribute('style')).toEqual(beforeBarDrag);
  await controls.getByRole('button', { name: 'Zoom out', exact: true }).click();
  expect(await scale()).toBeLessThan(zoomed);
  await canvas.focus();
  await expect(canvas).toBeFocused();
  const transform = await diagram.getAttribute('style');
  await page.keyboard.press('ArrowRight');
  expect(await diagram.getAttribute('style')).not.toEqual(transform);
  await page.getByRole('button', { name: 'Close cluster panel' }).click();
  for (const width of [1280, 1000]) {
    await page.setViewportSize({ width, height: width === 1000 ? 620 : 720 });
    await controls.getByRole('button', { name: 'Fit to view', exact: true }).click();
    const bar = await controls.boundingBox();
    const graph = await diagram.boundingBox();
    const frame = await canvas.boundingBox();
    if (!bar || !graph || !frame) throw new Error('Canvas geometry missing');
    expect(bar.x - frame.x).toBeGreaterThanOrEqual(16);
    expect(frame.y + frame.height - bar.y - bar.height).toBeGreaterThanOrEqual(16);
    expect(graph.y + graph.height).toBeLessThan(bar.y);
    expect(bar.x + bar.width).toBeLessThan(frame.x + frame.width);
    await expect(controls.getByText(/^\d+%$/)).toHaveText(`${Math.round((await scale()) * 100)}%`);
  }
});
