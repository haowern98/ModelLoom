import { expect, test } from '@playwright/test';

test('sidebar uses neutral selection, consistent icons and distinct keyboard focus', async ({
  page,
}) => {
  await page.goto('/');
  const rail = page.getByRole('complementary', { name: 'Main navigation' });
  const models = rail.getByRole('button', { name: 'Models', exact: true });
  const cluster = rail.getByRole('button', { name: 'Cluster', exact: true });
  const home = rail.getByRole('button', { name: 'Chat', exact: true });

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
  for (const name of ['Chat', 'Cluster', 'Models', 'API', 'Settings']) {
    const icon = rail.getByRole('button', { name, exact: true }).locator('svg');
    await expect(icon).toHaveCSS('width', '20px');
    await expect(icon).toHaveCSS('height', '20px');
    await expect(icon).toHaveAttribute('aria-hidden', 'true');
    expect(await icon.locator('path').count()).toBeGreaterThan(0);
  }
  await expect(
    rail.getByRole('button', { name: /Downloads|Local profile|More navigation/ }),
  ).toHaveCount(0);
  await cluster.hover();
  await expect(cluster).toHaveCSS('background-color', 'rgb(47, 47, 47)');
  await expect(models).toHaveAttribute('aria-current', 'page');
  await cluster.click();
  await page.mouse.move(500, 40);
  await expect(cluster).toHaveAttribute('aria-current', 'page');
  await expect(cluster).toHaveCSS('color', 'rgb(255, 255, 255)');
  await expect(cluster.locator('svg')).toHaveCSS('fill', 'rgb(255, 255, 255)');
  await expect(models).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await page.keyboard.press('Tab');
  await expect(models).toBeFocused();
  await expect(models).toHaveCSS('outline-color', 'rgb(171, 171, 171)');
  await expect(models).toHaveCSS('outline-style', 'solid');
  await expect(cluster).toHaveAttribute('aria-current', 'page');
  await page.keyboard.press('Enter');
  await expect(models).toHaveAttribute('aria-current', 'page');
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
  await expect(rail.getByRole('button', { name: 'API', exact: true }).locator('svg')).toHaveCSS(
    'fill',
    'rgb(255, 255, 255)',
  );
  for (const width of [1280, 1000]) {
    await page.setViewportSize({ width, height: width === 1000 ? 620 : 720 });
    await rail.getByRole('button', { name: 'Settings', exact: true }).click();
    const settings = rail.getByRole('button', { name: 'Settings', exact: true });
    await expect(settings).toHaveAttribute('aria-current', 'page');
    await expect(settings).toHaveCSS('background-color', 'rgb(47, 47, 47)');
    await expect(settings).toHaveCSS('box-shadow', 'none');
    await expect(settings.locator('svg')).toHaveCSS('fill', 'rgb(255, 255, 255)');
    await expect(settings).toBeInViewport();
    const bounds = await settings.boundingBox();
    expect(bounds?.width).toBe(36);
    expect(bounds?.height).toBe(36);
    expect(bounds!.y + bounds!.height / 2).toBeCloseTo(page.viewportSize()!.height - 26);
    await rail.getByRole('button', { name: 'Cluster', exact: true }).click();
    await page.mouse.move(500, 40);
    await page.screenshot({ path: `test-results/sidebar-neutral-${width}.png` });
  }
});

test('workspace matches the Codex frame and surface layers across destinations', async ({
  page,
}) => {
  await page.goto('/');
  const rail = page.getByRole('complementary', { name: 'Main navigation' });
  const workspace = page.getByRole('region', { name: 'ModelLoom workspace' });
  for (const width of [1280, 1000]) {
    await page.setViewportSize({ width, height: 720 });
    for (const name of ['Chat', 'Cluster', 'Models', 'API', 'Settings']) {
      await rail.getByRole('button', { name, exact: true }).click();
      await expect(rail).toHaveCSS('width', '52px');
      const button = (await rail.getByRole('button', { name, exact: true }).boundingBox())!;
      expect(button.x).toBe(8);
      expect(button.width).toBe(36);
      const frame = (await workspace.boundingBox())!;
      expect(frame.x).toBe(52);
      expect(width - frame.x - frame.width).toBe(4);
      expect(720 - frame.y - frame.height).toBe(4);
      for (const [corner, radius] of [
        ['top-left', 12],
        ['top-right', 12],
        ['bottom-right', 4],
        ['bottom-left', 12],
      ] as const) {
        await expect(workspace).toHaveCSS('border-' + corner + '-radius', radius + 'px');
      }
      const sidebar = workspace.getByRole('complementary').first();
      if (['Chat', 'Cluster', 'Settings'].includes(name)) {
        await expect(sidebar).toHaveCSS('width', '238px');
        expect((await sidebar.boundingBox())!.x).toBe(52);
        const layers = await sidebar.evaluate((node) => {
          const backgrounds = [];
          for (let parent = node.parentElement; parent; parent = parent.parentElement) {
            backgrounds.push(getComputedStyle(parent).backgroundColor);
          }
          return {
            sidebar: getComputedStyle(node).backgroundColor,
            content: getComputedStyle(node.nextElementSibling!).backgroundColor,
            backgrounds,
          };
        });
        expect(layers.sidebar).toBe('rgba(17, 17, 17, 0.65)');
        expect(layers.content).toBe('rgb(17, 17, 17)');
        expect(layers.backgrounds.every((colour) => colour === 'rgba(0, 0, 0, 0)')).toBe(true);
      } else {
        await expect(workspace).toHaveCSS('background-color', 'rgb(17, 17, 17)');
      }
      if (name === 'Settings') {
        await expect(
          page.getByRole('region', { name: 'Theme', exact: true }).locator('div').first(),
        ).toHaveCSS('border-radius', '16px');
      }
      if (width === 1280) {
        await page.screenshot({ path: test.info().outputPath(`workspace-${name}.png`) });
      }
    }
  }
});
