import { expect, test } from '@playwright/test';

test('unsaved assignments require Save or Discard, with X and Escape preserving edits', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const first = 'a'.repeat(64),
      second = 'b'.repeat(64);
    const uuid = 'GPU-12345678-1234-1234-1234-123456789abc';
    const commands: string[] = [];
    Reflect.set(window, '__clusterActions', commands);
    window.modelLoomRuntime = {
      command: () =>
        Promise.resolve({
          enabled: true,
          model: null,
          models: [
            { id: `model-${first}`, name: 'Qwen', size: '4 GB', blockCount: 8 },
            { id: `model-${second}`, name: 'Bonsai', size: '4 GB', blockCount: 8 },
          ],
          phase: 'stopped',
          error: null,
          device: {
            name: 'Local',
            os: 'Windows',
            cpuName: 'CPU',
            threads: 8,
            role: 'Coordinator',
            inventory: {
              sampledAt: 1,
              gpus: [
                {
                  id: uuid,
                  name: 'GPU',
                  pciVendorId: '10de',
                  totalMemoryBytes: 8 * 2 ** 30,
                  executionIdentity: { vendor: 'nvidia', uuid, pciBus: '00000000:01:00.0' },
                },
              ],
            },
          },
        }),
    };
    window.modelLoomCluster = {
      command: (input) => {
        commands.push(input.action);
        return Promise.resolve({
          ok: true,
          configurations: [],
          configuration: null,
          draft: null,
          load: {
            defaults: {
              automatic: false,
              contextLength: 2048,
              threads: null,
              evaluationBatch: 256,
              physicalBatch: 128,
              concurrency: 1,
              flashAttention: true,
            },
            cacheK: 'f16',
            cacheV: 'f16',
          },
          issues: [],
        });
      },
    };
  });
  await page.goto('http://127.0.0.1:5176');
  await expect(page.getByRole('button', { name: 'Configure Qwen' })).toBeVisible();
  await page.getByRole('button', { name: 'Cluster', exact: true }).click();
  await page.getByRole('button', { name: 'Choose model', exact: true }).click();
  await page.getByRole('menuitem', { name: /Qwen/ }).click();
  await page.getByRole('button', { name: /Edit layers for .* GPU/ }).click();
  const last = page.getByRole('textbox', { name: 'Last layer for Local GPU', exact: true });
  await page.getByRole('textbox', { name: 'First layer for Local GPU', exact: true }).fill('0');
  await last.fill('7');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  const range = page.getByRole('button', { name: 'Edit layers for Local GPU' });
  await page.getByRole('button', { name: 'Selected local model: Qwen' }).click();
  await page.getByRole('menuitem', { name: /Bonsai/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Unsaved changes' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('footer').getByRole('button')).toHaveText([
    'Save changes',
    'Discard changes',
  ]);
  const close = dialog.getByRole('button', { name: 'Close dialog' });
  for (const width of [1280, 1000]) {
    await page.setViewportSize({ width, height: 720 });
    const box = (await dialog.boundingBox())!,
      x = (await close.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(x.x).toBeGreaterThan(box.x + box.width / 2);
    expect(x.y).toBeLessThan(box.y + box.height / 2);
  }
  await close.click();
  await expect(range).toHaveText('0–7');
  await page.getByRole('button', { name: 'Selected local model: Qwen' }).click();
  await page.getByRole('menuitem', { name: /Bonsai/ }).click();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(range).toHaveText('0–7');
  await page.getByRole('button', { name: 'Selected local model: Qwen' }).click();
  await page.getByRole('menuitem', { name: /Bonsai/ }).click();
  await dialog.getByRole('button', { name: 'Discard changes' }).click();
  await expect(page.getByRole('button', { name: 'Selected local model: Bonsai' })).toBeVisible();
  await expect(range).toHaveText('Unassigned');
  await page.getByRole('button', { name: 'Selected local model: Bonsai' }).click();
  await page.getByRole('menuitem', { name: /Qwen/ }).click();
  await expect(range).toHaveText('Unassigned');
  expect(
    await page.evaluate(() => Reflect.get(window, '__clusterActions') as string[]),
  ).not.toContain('edit');
  expect(
    await page.evaluate(() => Reflect.get(window, '__clusterActions') as string[]),
  ).not.toContain('save');
});
