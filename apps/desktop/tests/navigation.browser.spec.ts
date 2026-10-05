import { expect, test } from '@playwright/test';

test('sidebar uses neutral selection, consistent icons and distinct keyboard focus', async ({
  page,
}) => {
  await page.goto('/');
  const rail = page.getByRole('complementary', { name: 'Main navigation' });
  const models = rail.getByRole('button', { name: 'Models', exact: true });
  const cluster = rail.getByRole('button', { name: 'Cluster', exact: true });
  const home = rail.getByRole('button', { name: 'Chat', exact: true });
  const more = rail.getByRole('button', { name: 'More navigation' });
  const mainIcons = rail.locator('button > svg');

  await page.mouse.move(500, 40);
  await expect(models).toHaveAttribute('aria-current', 'page');
  await expect(models).toHaveCSS('background-color', 'rgb(47, 47, 47)');
  await expect(models).toHaveCSS('color', 'rgb(255, 255, 255)');
  await expect(models).toHaveCSS('box-shadow', 'none');
  await expect(models).toHaveCSS('border-color', 'rgba(0, 0, 0, 0)');
  await expect(home).toBeEnabled();
  await expect(home).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(cluster).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(cluster).toHaveCSS('color', 'rgb(139, 139, 139)');
  for (let index = 0; index < 8; index++) {
    await expect(mainIcons.nth(index)).toHaveCSS('width', '20px');
    await expect(mainIcons.nth(index)).toHaveCSS('height', '20px');
    await expect(mainIcons.nth(index)).toHaveAttribute('stroke-width', '1.75');
  }
  await cluster.hover();
  await expect(cluster).toHaveCSS('background-color', 'rgb(47, 47, 47)');
  await expect(models).toHaveAttribute('aria-current', 'page');
  await cluster.click();
  await page.mouse.move(500, 40);
  await expect(cluster).toHaveAttribute('aria-current', 'page');
  await expect(cluster).toHaveCSS('color', 'rgb(255, 255, 255)');
  await expect(models).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await page.keyboard.press('Tab');
  await expect(models).toBeFocused();
  await expect(models).toHaveCSS('outline-color', 'rgb(171, 171, 171)');
  await expect(models).toHaveCSS('outline-style', 'solid');
  await expect(cluster).toHaveAttribute('aria-current', 'page');
  await page.keyboard.press('Enter');
  await expect(models).toHaveAttribute('aria-current', 'page');
  await more.click();
  await expect(more).toHaveCSS('background-color', 'rgb(47, 47, 47)');
  await expect(
    rail.getByLabel('Additional screens').getByRole('button', { name: 'API', exact: true }),
  ).toHaveCount(0);
  await rail.getByRole('button', { name: 'API', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'API', exact: true })).toBeVisible();
  await expect(rail.getByRole('button', { name: 'API', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(rail.getByRole('button', { name: 'API', exact: true })).toHaveCSS(
    'background-color',
    'rgb(47, 47, 47)',
  );
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  for (const width of [1280, 1000]) {
    await page.setViewportSize({ width, height: width === 1000 ? 620 : 720 });
    await rail.getByRole('button', { name: 'Settings', exact: true }).click();
    const settings = rail.getByRole('button', { name: 'Settings', exact: true });
    await expect(settings).toHaveAttribute('aria-current', 'page');
    await expect(settings).toHaveCSS('background-color', 'rgb(47, 47, 47)');
    await expect(settings).toHaveCSS('box-shadow', 'none');
    await expect(settings).toBeInViewport();
    const bounds = await settings.boundingBox();
    expect(bounds?.width).toBe(36);
    expect(bounds?.height).toBe(36);
    await rail.getByRole('button', { name: 'Cluster', exact: true }).click();
    await page.mouse.move(500, 40);
    await page.screenshot({ path: `test-results/sidebar-neutral-${width}.png` });
  }
});
