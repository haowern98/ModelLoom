import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

async function choose(page: Page, model: string, mode: 'Auto place' | 'Place manually') {
  await page.getByRole('button', { name: /^Selected demo model:|^Choose model$/ }).click();
  await page.getByRole('menuitem', { name: new RegExp(model) }).click();
  await expect(page.getByRole('dialog', { name: 'Plan layer placement' })).toContainText(
    `Choose how to assign layers for ${model}.`,
  );
  await page.getByRole('button', { name: mode, exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cancel loading' })).toHaveCount(0);
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
  await expect(page.getByText('Unassigned', { exact: true })).toHaveCount(5);
  const run = page.getByRole('button', { name: 'Load model', exact: true });
  await run.click();
  await expect(page.getByRole('alert')).toContainText('all 32 sample layers exactly once');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Dismiss notification' }).click();
  const range = page.getByRole('button', { name: 'Edit layers for inference-node GPU 0' });
  const done = page.getByRole('button', { name: 'Done', exact: true });
  await range.click();
  const first = page.getByRole('textbox', { name: 'First layer for inference-node GPU 0' });
  const last = page.getByRole('textbox', { name: 'Last layer for inference-node GPU 0' });
  await expect(first).toHaveValue('');
  await expect(last).toHaveValue('');
  await first.fill('0');
  await last.fill('30');
  await done.click();
  await expect(last).toBeHidden();
  await expect(range).toHaveText('0–30');
  await run.click();
  await expect(page.getByRole('alert')).toContainText('all 32 sample layers');
  await page.getByRole('button', { name: 'Dismiss notification' }).click();
  await expect(page.getByRole('button', { name: /Keep draft|Save changes/ })).toHaveCount(0);
  await range.click();
  await last.fill('31');
  await done.click();
  await run.click();
  await expect(page.getByRole('dialog', { name: 'Switch demo model?' })).toContainText(
    'Qwen3.8-27B',
  );
  await page
    .getByRole('dialog', { name: 'Switch demo model?' })
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
  await expect(run).toBeFocused();
  await expect(page.getByRole('img', { name: 'GPU in use' })).toHaveCount(5);
  await expect(range).toHaveText('0–31');
  await run.click();
  await page.getByRole('button', { name: 'Switch and run demo' }).click();
  await expect(page.getByRole('button', { name: 'Cancel loading' })).toBeVisible();
  await expect(range).toBeDisabled();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Unload model' })).toBeVisible();
  await expect(range).toHaveText('0–31');
  await expect(page.getByRole('img', { name: 'GPU in use' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Unload model' }).click();
  await expect(run).toBeVisible();
  await expect(page.getByRole('img', { name: 'GPU in use' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Discard changes' })).toHaveCount(0);
  await expect(range).toHaveText('0–31');
  await page.getByRole('button', { name: 'Dismiss notification' }).click();
  await page.getByRole('button', { name: 'Assignment options' }).click();
  await page.getByRole('menuitem', { name: 'Reset to default' }).click();
  await expect(page.getByText(/^Planned layers/)).toHaveCount(5);
  await expect(page.getByRole('button', { name: 'Cancel loading' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(range).toHaveText('0–31');
});

test('auto placement is unloaded, loading can be cancelled and completes across navigation', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Cluster', exact: true }).click();
  await page.getByRole('button', { name: 'Unload model' }).click();
  await choose(page, 'Llama 3.1 8B', 'Auto place');
  await expect(page.getByText(/^Planned layers/)).toHaveCount(5);
  await expect(page.getByRole('img', { name: 'GPU in use' })).toHaveCount(0);
  await page.clock.install();
  await page.getByRole('button', { name: 'Load model' }).click();
  await expect(page.getByRole('button', { name: 'Cancel loading' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Selected demo model: Llama 3.1 8B' }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Cancel loading' }).click();
  await page.getByRole('button', { name: 'Dismiss notification' }).click();
  await page.clock.runFor(1000);
  await expect(page.getByRole('button', { name: 'Load model' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'GPU in use' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Load model' }).click();
  await page.getByRole('button', { name: 'Models', exact: true }).click();
  await page.clock.runFor(1000);
  await page.getByRole('button', { name: 'Actions for Llama 3.1 8B' }).click();
  await expect(page.getByRole('button', { name: 'Remove model entry' })).toBeDisabled();
  await page.getByRole('button', { name: 'Cluster', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Unload model' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: /^Edit layers for / }).filter({ hasText: '24–31' }),
  ).toBeVisible();
});

test('model menu supports keyboard choices, cancellation and removed library entries', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Actions for Gemma 2 9B' }).click();
  await page.getByRole('button', { name: 'Remove model entry' }).click();
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
  await expect(placementDialog.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0);
  const close = placementDialog.getByRole('button', { name: 'Close dialog' });
  const dialogBounds = await placementDialog.boundingBox();
  const closeBounds = await close.boundingBox();
  const manualBounds = await placementDialog
    .getByRole('button', { name: 'Place manually', exact: true })
    .boundingBox();
  if (!dialogBounds || !closeBounds || !manualBounds) throw new Error('Missing placement controls');
  expect(closeBounds.x).toBeGreaterThan(dialogBounds.x + dialogBounds.width / 2);
  expect(closeBounds.y).toBeLessThan(manualBounds.y);
  await close.click();
  await expect(selector).toBeFocused();
  await selector.click();
  await page.getByRole('menuitem', { name: /Mistral 7B Instruct/ }).click();
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
  const run = page.getByRole('button', { name: 'Unload model' });
  const toggle = page.getByRole('button', { name: 'Cluster panel', exact: true });
  const actions = page.getByRole('group', { name: 'Cluster actions', exact: true });
  const capsule = page.getByRole('group', { name: 'Assignment history' });
  await expect(actions.getByRole('button')).toHaveCount(3);
  await expect(actions.getByRole('button', { name: 'Save configuration' })).toBeDisabled();
  await expect(actions.getByRole('button', { name: 'Unload model' })).toBeVisible();
  await expect(actions.getByRole('button', { name: 'Cluster panel', exact: true })).toHaveCount(1);
  await expect(toggle).toBeVisible();
  await expect(capsule).toHaveCSS('border-radius', '999px');
  await expect(selector).toHaveCSS('font-size', '13px');
  await expect(selector).toHaveCSS('border-width', '0px');
  await expect(selector).toHaveCSS('box-shadow', 'none');
  await expect(run).toHaveAttribute('title', 'Unload model');
  const header = selector.locator('xpath=ancestor::header');
  await expect(header.getByRole('heading')).toHaveCount(0);
  await expect(header.getByRole('searchbox')).toHaveCount(0);
  await expect(header.getByRole('button', { name: 'Add', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Cluster', exact: true })).toHaveCount(1);
  for (const font of ['system', 'Arial']) {
    if (font === 'Arial')
      await page.addStyleTag({ content: ':root { font-family: Arial, sans-serif; }' });
    for (const width of [1280, 1100, 900]) {
      await page.setViewportSize({ width, height: width === 900 ? 620 : 720 });
      const modelBounds = await selector.boundingBox();
      const runBounds = await run.boundingBox();
      const toggleBounds = await toggle.boundingBox();
      const capsuleBounds = await capsule.boundingBox();
      if (!modelBounds || !runBounds || !toggleBounds || !capsuleBounds)
        throw new Error('Missing toolbar controls');
      expect(capsuleBounds.width).toBe(64);
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
  await toggle.click();
  const options = page.getByRole('button', { name: 'Assignment options' });
  await options.focus();
  await options.press('Enter');
  await expect(page.getByRole('menuitem', { name: 'Reset to default' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(options).toBeFocused();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const label = selector.locator('span');
  await label.evaluate((element) => {
    element.textContent = 'A very long model name that must never push away the Run icon';
  });
  await expect(label).toHaveCSS('text-overflow', 'ellipsis');
  expect(await label.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  await expect(selector.locator('svg')).toBeInViewport();
  await page.screenshot({ path: 'test-results/cluster-model-name-truncation.png' });
});

test('toolbar overflow resets the draft without loading the model', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Cluster', exact: true }).click();
  await choose(page, 'Llama 3.1 8B', 'Place manually');
  const gpu = page.getByRole('button', { name: 'Edit layers for inference-node GPU 0' });
  await gpu.click();
  await page.getByRole('textbox', { name: 'First layer for inference-node GPU 0' }).fill('0');
  await page.getByRole('textbox', { name: 'Last layer for inference-node GPU 0' }).fill('1');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(gpu).toHaveText('0–1');
  await page.getByRole('button', { name: 'Assignment options' }).click();
  await page.getByRole('menuitem', { name: 'Reset to default' }).click();
  await expect(gpu).not.toHaveText('0–1');
  await expect(page.getByRole('button', { name: 'Load model', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(gpu).toHaveText('0–1');
});
