import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

async function choose(page: Page, model: string, mode: 'Auto place' | 'Place manually') {
  await page.getByRole('button', { name: /^Selected demo model:|^Choose model$/ }).click();
  await page.getByRole('menuitem', { name: new RegExp(model) }).click();
  await expect(page.getByRole('dialog', { name: 'Plan layer placement' })).toContainText(
    'The model loads only when you click Run',
  );
  await page.getByRole('button', { name: mode, exact: true }).click();
}

test('manual placement starts unassigned and validates all selected-model layers before switching', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Cluster', exact: true }).click();
  await choose(page, 'Llama 3.1 8B', 'Place manually');
  await expect(page.getByRole('button', { name: 'Selected demo model: Llama 3.1 8B' })).toHaveText(
    'Llama 3.1 8B',
  );
  await expect(page.getByText(/^Planned layers/)).toHaveCount(0);
  await expect(page.getByText('Unassigned', { exact: true })).toHaveCount(5);
  const run = page.getByRole('button', { name: 'Run model', exact: true });
  await run.click();
  await expect(page.getByRole('alert')).toContainText('all 32 sample layers exactly once');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit layers for inference-node GPU 0' }).click();
  const first = page.getByRole('spinbutton', { name: 'First layer for GPU 0' });
  const last = page.getByRole('spinbutton', { name: 'Last layer for GPU 0' });
  await expect(first).toHaveValue('');
  await expect(last).toHaveValue('');
  await first.fill('0');
  await last.fill('30');
  await run.click();
  await expect(page.getByRole('alert')).toContainText('all 32 sample layers');
  await expect(page.getByRole('button', { name: /Keep draft|Save changes/ })).toHaveCount(0);
  await last.fill('31');
  await run.click();
  await expect(page.getByRole('dialog', { name: 'Switch demo model?' })).toContainText(
    'Qwen3.8-27B',
  );
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(run).toBeFocused();
  await expect(page.getByText('Active layers 96 – 127')).toBeVisible();
  await expect(page.getByText('Planned layers 0 – 31')).toBeVisible();
  await run.click();
  await page.getByRole('button', { name: 'Switch and run demo' }).click();
  await expect(page.getByRole('button', { name: 'Cancel loading' })).toBeVisible();
  await expect(first).toBeDisabled();
  await expect(last).toBeDisabled();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Stop model' })).toBeVisible();
  await expect(page.getByText('Layers 0 – 31', { exact: true })).toBeVisible();
  await expect(page.getByText('In use', { exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: 'Stop model' }).click();
  await expect(run).toBeVisible();
  await expect(page.getByText('In use', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Discard changes' }).click();
  await expect(first).toHaveValue('');
  await expect(last).toHaveValue('');
});

test('auto placement is unloaded, loading can be cancelled and completes across navigation', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Cluster', exact: true }).click();
  await page.getByRole('button', { name: 'Stop model' }).click();
  await choose(page, 'Llama 3.1 8B', 'Auto place');
  await expect(page.getByText(/^Planned layers/)).toHaveCount(5);
  await expect(page.getByText('In use', { exact: true })).toHaveCount(0);
  await page.clock.install();
  await page.getByRole('button', { name: 'Run model' }).click();
  await expect(page.getByRole('button', { name: 'Cancel loading' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Selected demo model: Llama 3.1 8B' }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Cancel loading' }).click();
  await page.clock.runFor(1000);
  await expect(page.getByRole('button', { name: 'Run model' })).toBeVisible();
  await expect(page.getByText('In use', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Run model' }).click();
  await page.getByRole('button', { name: 'Models', exact: true }).click();
  await page.clock.runFor(1000);
  await page.getByRole('button', { name: 'Actions for Llama 3.1 8B' }).click();
  await expect(page.getByRole('button', { name: 'Remove demo entry' })).toBeDisabled();
  await page.getByRole('button', { name: 'Cluster', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop model' })).toBeVisible();
  await expect(page.getByText('Layers 24 – 31', { exact: true })).toBeVisible();
});

test('model menu supports keyboard choices, cancellation and removed library entries', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Actions for Gemma 2 9B' }).click();
  await page.getByRole('button', { name: 'Remove demo entry' }).click();
  await page.getByRole('button', { name: 'Remove entry', exact: true }).click();
  await page.getByRole('button', { name: 'Cluster', exact: true }).click();
  const selector = page.getByRole('button', { name: 'Selected demo model: Qwen3.8-27B' });
  await selector.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem')).toHaveCount(4);
  await expect(page.getByRole('menuitem', { name: /Qwen3.8-27B/ })).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.getByRole('menuitem', { name: /Phi 3 Mini/ })).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Plan layer placement' })).toContainText(
    'Mistral 7B Instruct',
  );
  const placementDialog = page.getByRole('dialog', { name: 'Plan layer placement' });
  const cancel = placementDialog.getByRole('button', { name: 'Cancel', exact: true });
  await expect(cancel).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(cancel).toHaveCSS('color', 'rgb(171, 171, 171)');
  const dialogBounds = await placementDialog.boundingBox();
  const cancelBounds = await cancel.boundingBox();
  const manualBounds = await placementDialog
    .getByRole('button', { name: 'Place manually', exact: true })
    .boundingBox();
  if (!dialogBounds || !cancelBounds || !manualBounds)
    throw new Error('Missing placement controls');
  expect(cancelBounds.x + cancelBounds.width / 2).toBeCloseTo(
    dialogBounds.x + dialogBounds.width / 2,
    1,
  );
  expect(cancelBounds.y).toBeGreaterThan(manualBounds.y + manualBounds.height);
  await page.keyboard.press('Escape');
  await expect(selector).toBeFocused();
  await expect(selector).toHaveText('Qwen3.8-27B');
  await selector.click();
  await page.mouse.click(1200, 110);
  await expect(page.getByRole('menu')).toHaveCount(0);
});

test('compact cluster toolbar stays contained without repeating the sidebar heading', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Models', exact: true }).click();
  const compassBounds = await page.getByRole('button', { name: 'Explore models' }).boundingBox();
  const modelsWorkspace = await page
    .getByRole('region', { name: 'ModelLoom workspace' })
    .boundingBox();
  if (!compassBounds || !modelsWorkspace) throw new Error('Missing Models toolbar geometry');
  const rightGap =
    modelsWorkspace.x + modelsWorkspace.width - compassBounds.x - compassBounds.width;
  await page.getByRole('button', { name: 'Cluster', exact: true }).click();
  const selector = page.getByRole('button', { name: 'Selected demo model: Qwen3.8-27B' });
  const run = page.getByRole('button', { name: 'Stop model' });
  const toggle = page.getByRole('button', { name: 'Cluster panel', exact: true });
  const capsule = page.getByRole('group', { name: 'Cluster actions', exact: true });
  await expect(capsule.getByRole('button')).toHaveCount(1);
  await expect(capsule.getByRole('button', { name: 'Stop model' })).toBeVisible();
  await expect(capsule.getByRole('button', { name: 'Cluster panel', exact: true })).toHaveCount(0);
  await expect(toggle).toBeVisible();
  await expect(capsule).toHaveCSS('border-radius', '999px');
  await expect(selector).toHaveCSS('font-size', '13px');
  await expect(selector).toHaveCSS('border-width', '0px');
  await expect(selector).toHaveCSS('box-shadow', 'none');
  await expect(run).toHaveAttribute('title', 'Stop model');
  const header = selector.locator('xpath=ancestor::header');
  await expect(header.getByRole('heading')).toHaveCount(0);
  await expect(header.getByRole('searchbox')).toHaveCount(0);
  await expect(header.getByRole('button', { name: 'Add', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Cluster', exact: true })).toHaveCount(1);
  for (const font of ['system', 'Arial']) {
    if (font === 'Arial')
      await page.addStyleTag({ content: ':root { font-family: Arial, sans-serif; }' });
    for (const width of [1280, 1100, 1000]) {
      await page.setViewportSize({ width, height: width === 1000 ? 620 : 720 });
      const modelBounds = await selector.boundingBox();
      const runBounds = await run.boundingBox();
      const toggleBounds = await toggle.boundingBox();
      const capsuleBounds = await capsule.boundingBox();
      if (!modelBounds || !runBounds || !toggleBounds || !capsuleBounds)
        throw new Error('Missing toolbar controls');
      expect(capsuleBounds.width).toBe(32);
      expect(capsuleBounds.height).toBe(32);
      expect(toggleBounds.width).toBe(32);
      expect(toggleBounds.height).toBe(32);
      const centreY = modelBounds.y + modelBounds.height / 2;
      for (const bounds of [runBounds, toggleBounds])
        expect(bounds.y + bounds.height / 2).toBeCloseTo(centreY, 1);
      expect(modelBounds.width).toBeLessThanOrEqual(180);
      expect(capsuleBounds.x - (modelBounds.x + modelBounds.width)).toBeCloseTo(8, 1);
      expect(runBounds.x).toBeGreaterThanOrEqual(capsuleBounds.x);
      const workspace = await page
        .getByRole('region', { name: 'ModelLoom workspace' })
        .boundingBox();
      if (!workspace) throw new Error('Missing Cluster workspace geometry');
      expect(workspace.x + workspace.width - toggleBounds.x - toggleBounds.width).toBeCloseTo(
        rightGap,
        1,
      );
      expect(capsuleBounds.x + capsuleBounds.width).toBeLessThan(width);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
  }
  const label = selector.locator('span');
  await label.evaluate((element) => {
    element.textContent = 'A very long model name that must never push away the Run icon';
  });
  await expect(label).toHaveCSS('text-overflow', 'ellipsis');
  expect(await label.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  await expect(selector.locator('svg')).toBeInViewport();
  await page.screenshot({ path: 'test-results/cluster-model-name-truncation.png' });
});
