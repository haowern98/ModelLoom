import { expect, test } from '@playwright/test';

// Allow native scrollbar painting for this visual regression case.
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

test('panel scrolling retains its padded frame and contains a neutral scrollbar', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Cluster', exact: true }).click();
  await page.getByRole('button', { name: 'Select studio-desktop' }).click();
  const panel = page.getByRole('complementary', { name: 'Cluster panel' });

  const content = panel.getByRole('region', { name: 'Cluster panel content' });
  for (const width of [1280, 1000]) {
    await page.setViewportSize({ width, height: 480 });
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect(content).toBeVisible();
    const frame = await panel.boundingBox();
    const viewport = await content.boundingBox();
    if (!frame || !viewport) throw new Error('Panel frame or inner scroll area is missing');
    expect(viewport.y - frame.y).toBeGreaterThanOrEqual(18);
    expect(frame.y + frame.height - viewport.y - viewport.height).toBeGreaterThanOrEqual(18);
    const header = await panel.locator('header').boundingBox();
    if (!header) throw new Error('Panel header is missing');
    expect(header.x - frame.x).toBeCloseTo(frame.x + frame.width - header.x - header.width, 0);
    expect(viewport.x + viewport.width - 6 - header.x - header.width).toBeCloseTo(12, 0);
    expect(frame.x + frame.width - viewport.x - viewport.width).toBeGreaterThanOrEqual(0);
    expect(frame.x + frame.width - viewport.x - viewport.width).toBeLessThanOrEqual(2);
    await content.evaluate((element) => {
      element.scrollTop = 0;
    });
    await page.mouse.move(10, 10);
    const scrollbar = await content.evaluate((element) => ({
      thumb: getComputedStyle(element, '::-webkit-scrollbar-thumb').backgroundColor,
      overflow: element.scrollHeight - element.clientHeight,
    }));
    expect(scrollbar.thumb).toBe('rgba(0, 0, 0, 0)');
    const clip = { x: viewport.x + viewport.width - 6, y: viewport.y + 6, width: 6, height: 40 };
    const hiddenRail = await page.screenshot({ clip });
    // Hovering even the outer padding reveals the thumb; no rail targeting is required.
    await page.mouse.move(frame.x + 4, frame.y + 40);
    // Native scrollbar pseudo-element hover is painted by Chromium's scrollbar widget,
    // so compare its rendered strip rather than the base pseudo-element computed style.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    expect(await page.screenshot({ clip })).not.toEqual(hiddenRail);
    const hoveredViewport = await content.boundingBox();
    expect(hoveredViewport).toEqual(viewport);
    await page.mouse.move(10, 10);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    expect(await page.screenshot({ clip })).toEqual(hiddenRail);
    // A short viewport with both GPU layer editors retains real scrolling in the compact editor,
    // then exercise its actual middle and bottom instead of assuming a minimum content length.
    expect(scrollbar.overflow).toBeGreaterThan(0);
    await content.evaluate((element) => {
      element.scrollTop = 0;
    });
    await page.screenshot({ path: `test-results/cluster-panel-top-${width}.png` });
    await content.hover();
    await page.mouse.wheel(0, scrollbar.overflow / 2);
    await expect.poll(() => content.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    expect(await panel.boundingBox()).toEqual(frame);
    expect(await content.boundingBox()).toEqual(viewport);
    expect(await panel.evaluate((element) => element.scrollTop)).toBe(0);
    await page.screenshot({ path: `test-results/cluster-panel-middle-${width}.png` });
    await content.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    expect(await content.evaluate((element) => element.scrollTop)).toBe(scrollbar.overflow);
    expect(await panel.boundingBox()).toEqual(frame);
    expect(await content.boundingBox()).toEqual(viewport);
    await expect(page.getByRole('spinbutton', { name: 'Last layer for GPU 1' })).toBeInViewport();
    await page.screenshot({ path: `test-results/cluster-panel-bottom-${width}.png` });
  }
  await panel.getByRole('button', { name: 'Back to cluster overview', exact: true }).click();
  const overviewFrame = await panel.boundingBox();
  const overviewHeader = await panel.locator('header').boundingBox();
  if (!overviewFrame || !overviewHeader) throw new Error('Overview frame or header is missing');
  expect(overviewHeader.x - overviewFrame.x).toBeCloseTo(
    overviewFrame.x + overviewFrame.width - overviewHeader.x - overviewHeader.width,
    0,
  );
  await page.getByRole('button', { name: 'Select studio-desktop' }).click();
  await page.getByRole('spinbutton', { name: 'First layer for GPU 1' }).fill('29');
  await expect(page.getByRole('button', { name: 'Apply and restart' })).toBeInViewport();
  await page.getByRole('button', { name: 'Apply and restart' }).focus();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Select studio-desktop' })).toBeFocused();
});
