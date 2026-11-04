import { expect, test } from '@playwright/test';

test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] }, reducedMotion: 'reduce' });

test('the Cluster summary scrolls inside its own frame in short windows', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Cluster', exact: true }).click();
  await page.getByRole('button', { name: 'Fit to view', exact: true }).click();
  const toggle = page.getByRole('button', { name: 'Cluster panel', exact: true });
  await toggle.click();
  const panel = page.getByRole('complementary', { name: 'Cluster panel' });
  const card = page.getByRole('article', { name: 'studio-desktop', exact: true });
  await expect(panel).toHaveCSS('scrollbar-width', 'thin');
  await expect(panel).toHaveCSS('scrollbar-color', 'rgba(255, 255, 255, 0.157) rgba(0, 0, 0, 0)');
  await expect(panel).toHaveCSS('overscroll-behavior', 'contain');

  for (const width of [1280, 1000]) {
    await page.setViewportSize({ width, height: 480 });
    await panel.evaluate((element) => {
      element.scrollTop = 0;
    });
    const frame = await panel.boundingBox();
    const device = await card.boundingBox();
    const heading = panel.getByRole('heading', { name: 'Cluster overview' });
    await expect(heading).toBeInViewport();
    expect((await heading.boundingBox())!.x - frame!.x).toBeCloseTo(20, 0);
    const overflow = await panel.evaluate((element) => element.scrollHeight - element.clientHeight);
    expect(overflow).toBeGreaterThan(0);
    await panel.hover();
    await page.mouse.wheel(0, overflow);
    await expect.poll(() => panel.evaluate((element) => element.scrollTop)).toBe(overflow);
    await expect(
      panel.getByRole('group', { name: 'Layer assignment for inference-node' }),
    ).toBeInViewport();
    expect(await panel.boundingBox()).toEqual(frame);
    expect(await card.boundingBox()).toEqual(device);
  }

  await panel.press('Escape');
  await expect(panel).toBeHidden();
  await expect(toggle).toBeFocused();
});
