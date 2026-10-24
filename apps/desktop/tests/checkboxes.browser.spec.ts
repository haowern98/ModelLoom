import { expect, test } from '@playwright/test';
import type { Locator } from '@playwright/test';

async function checkGeometry(scope: Locator, checkboxes: Locator, originalSize: number) {
  const measure = () =>
    scope.evaluate((element) =>
      Array.from(
        element.querySelectorAll('h1, h2, h3, label, p, button, input, select, textarea'),
      ).map((node) => {
        const box = node.getBoundingClientRect();
        return {
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
          font: getComputedStyle(node).fontSize,
        };
      }),
    );
  // Recreate the previous native checkbox footprint for an exact layout comparison.
  await checkboxes.evaluateAll(
    (nodes, size) =>
      nodes.forEach((node) => {
        const style = (node as HTMLElement).style;
        style.setProperty('appearance', 'auto');
        style.setProperty('width', `${size}px`);
        style.setProperty('height', `${size}px`);
      }),
    originalSize,
  );
  const before = await measure();
  await checkboxes.evaluateAll((nodes) => nodes.forEach((node) => node.removeAttribute('style')));
  for (const checkbox of await checkboxes.all()) {
    await expect(checkbox).toHaveCSS('appearance', 'none');
    await expect(checkbox).toHaveCSS('width', `${originalSize}px`);
    await expect(checkbox).toHaveCSS('height', `${originalSize}px`);
    const visual = await checkbox.evaluate((node) => {
      const box = getComputedStyle(node, '::before');
      const mark = getComputedStyle(node, '::after');
      return {
        width: box.width,
        height: box.height,
        radius: box.borderRadius,
        border: box.borderTopWidth,
        markWidth: mark.width,
        markHeight: mark.height,
      };
    });
    expect(visual).toEqual({
      width: '16px',
      height: '16px',
      radius: '2px',
      border: '1px',
      markWidth: '12px',
      markHeight: '12px',
    });
  }
  expect(await measure()).toEqual(before);
}

test('model checkboxes match the reference without moving text, switches or controls', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Configure Qwen3.8-27B' }).click();
  const form = page.locator('form');
  const checkboxes = form.getByRole('checkbox');
  await expect(checkboxes).toHaveCount(9);
  for (const width of [1280, 1000]) {
    await page.setViewportSize({ width, height: 900 });
    await checkGeometry(form, checkboxes, 14);
  }
  const responseLimit = form.getByRole('checkbox', { name: 'Enable Maximum Response Length' });
  await responseLimit.focus();
  const checked = await responseLimit.isChecked();
  await page.keyboard.press('Space');
  await expect(responseLimit).toBeChecked({ checked: !checked });
  expect(await responseLimit.evaluate((node) => getComputedStyle(node, '::after').opacity)).toBe(
    checked ? '0' : '1',
  );
  await responseLimit
    .locator('..')
    .screenshot({ path: 'E:/ModelLoom-Project/plans/model-checkbox.png' });
});

test('Cluster hardware checkboxes preserve layout, labels and disabled behavior', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Cluster', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Cluster navigation' })
    .getByRole('button', { name: /^Connections/u })
    .click();
  await page.getByRole('tab', { name: 'Share this PC', exact: true }).click();
  const panel = page.getByRole('tabpanel', { name: 'Share this PC', exact: true });
  const checkboxes = panel.getByRole('checkbox');
  await expect(checkboxes).toHaveCount(2);
  for (const width of [1280, 1000]) {
    await page.setViewportSize({ width, height: 900 });
    await checkGeometry(panel, checkboxes, 14);
  }
  const sharing = panel.getByRole('switch', { name: 'Allow connections' });
  if (!(await sharing.isChecked())) await sharing.click();
  const gpu = panel.getByRole('checkbox', { name: 'GPU', exact: true });
  const wasChecked = await gpu.isChecked();
  await panel.getByText('GPU', { exact: true }).click();
  await expect(gpu).toBeChecked({ checked: !wasChecked });
  await gpu
    .locator('../..')
    .screenshot({ path: 'E:/ModelLoom-Project/plans/cluster-checkboxes.png' });
  await sharing.click();
  for (const checkbox of await checkboxes.all()) await expect(checkbox).toBeDisabled();
});
