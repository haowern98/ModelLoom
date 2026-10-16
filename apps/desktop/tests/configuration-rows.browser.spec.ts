import { expect, test } from '@playwright/test';
import { record } from '../../../packages/core/src/model-configuration/test-fixtures';

const name = 'A very long configuration name that must scroll without hiding the delete button';
for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`configuration row truncation, hover, focus and deletion with motion ${reducedMotion}`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion });
    await page.addInitScript(
      ({ name, defaults }) => {
        const modelId = 'a'.repeat(64);
        const configuration = {
          id: '12345678-1234-4234-8234-123456789abc',
          name,
          revision: 1,
          modelId,
          blockCount: 8,
          profileId: 'test',
          load: { defaults, cacheK: 'q8_0' as const, cacheV: 'q8_0' as const },
          runs: [],
        };
        let configurations = [configuration];
        window.modelLoomRuntime = {
          command: () =>
            Promise.resolve({
              enabled: true,
              phase: 'stopped',
              error: null,
              model: { id: `model-${modelId}`, name: 'Fixture model', size: '4 GB', blockCount: 8 },
            }),
        };
        window.modelLoomCluster = {
          command: (command) => {
            if (command.action === 'delete') configurations = [];
            return Promise.resolve({
              ok: true,
              configurations,
              configuration:
                command.action === 'read' && command.configurationId === configuration.id
                  ? configuration
                  : null,
              draft: null,
              load: configuration.load,
              issues: [],
            });
          },
        };
      },
      { name, defaults: record().load },
    );
    await page.goto('http://127.0.0.1:5176');
    await page.getByRole('button', { name: 'Cluster', exact: true }).click();
    const row = page.locator('[data-configuration-id]');
    const label = row.locator('[data-sidebar-title]');
    const text = label.locator('span');
    const trash = row.getByRole('button', { name: `Delete configuration: ${name}` });
    const select = row.getByRole('button', { name, exact: true });
    await expect(row).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(row).toHaveCSS('border-radius', '10px');
    await expect(select).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(select).toHaveCSS('border-radius', '10px');
    await expect(trash).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(label).toHaveAttribute('data-overflow', 'true');
    await expect(trash).toHaveCSS('opacity', '0');
    await expect(text).toHaveCSS('transform', 'none');
    const sizes = await label.evaluate((element) => ({
      width: element.clientWidth,
      text: element.scrollWidth,
    }));
    expect(sizes.text).toBeGreaterThan(sizes.width);
    await row.hover();
    await expect(row).toHaveCSS('background-color', 'rgb(47, 47, 47)');
    await expect(select).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(trash).toHaveCSS('opacity', '1');
    await expect(trash).toHaveCSS('width', '32px');
    if (reducedMotion === 'no-preference')
      await row.screenshot({ path: 'E:/ModelLoom-Project/plans/configuration-row-hover.png' });
    if (reducedMotion === 'reduce') await expect(text).toHaveCSS('animation-name', 'none');
    else
      await expect
        .poll(
          () =>
            text.evaluate((element) => {
              const transform = getComputedStyle(element).transform;
              return transform === 'none' ? 0 : new DOMMatrixReadOnly(transform).m41;
            }),
          { timeout: 5000 },
        )
        .toBeLessThan(-1);
    await page.getByRole('heading', { name: 'Cluster', exact: true }).hover();
    await expect(text).toHaveCSS('transform', 'none');
    await expect(trash).toHaveCSS('opacity', '0');
    await expect(row).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(select).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await select.click();
    await page.getByRole('heading', { name: 'Cluster', exact: true }).hover();
    await expect(select).toHaveAttribute('aria-pressed', 'true');
    await expect(row).toHaveCSS('background-color', 'rgb(47, 47, 47)');
    await expect(select).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(select).toHaveCSS('border-radius', '10px');
    await expect(trash).toHaveCSS('opacity', '0');
    await row.getByRole('button', { name, exact: true }).focus();
    await page.keyboard.press('Tab');
    await expect(trash).toBeFocused();
    await expect(trash).toHaveCSS('opacity', '1');
    await trash.click();
    const dialog = page.getByRole('dialog', { name: 'Delete configuration?' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(row).toHaveCount(1);
    await row.hover();
    await trash.click();
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(row).toHaveCount(0);
  });
}
