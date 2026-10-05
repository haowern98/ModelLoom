import { expect, test } from '@playwright/test';

test('connection dropdown supports keyboard switching, dismissal and return focus', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Cluster', exact: true }).click();
  await page.getByRole('button', { name: 'Cluster panel', exact: true }).click();
  const panel = page.getByRole('complementary', { name: 'Cluster panel' });
  const trigger = page.getByRole('button', { name: 'Add', exact: true });
  await expect(trigger).toHaveText('Add');
  await expect(trigger.locator('svg')).toHaveCount(1);
  const bounds = await trigger.boundingBox();
  if (!bounds) throw new Error('Add button is missing');
  for (const x of [bounds.x + 5, bounds.x + bounds.width - 5]) {
    await page.mouse.move(x, bounds.y + bounds.height / 2);
    await expect(trigger).toHaveCSS('background-color', 'rgb(229, 229, 229)');
  }
  await trigger.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Add device', exact: true })).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.getByRole('menuitem', { name: 'Share this PC' })).toBeFocused();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(panel.getByRole('heading', { name: 'Join cluster' })).toBeVisible();
  await expect(page.getByRole('menu')).toHaveCount(0);
  await panel.getByRole('button', { name: 'Close cluster panel' }).click();
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveText('Add');
  await trigger.click();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await expect(page.getByRole('menu')).toHaveCount(0);
  await trigger.click();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await trigger.click();
  await page.getByRole('searchbox', { name: 'Find devices' }).click();
  await expect(page.getByRole('menu')).toHaveCount(0);
});

test('joining views reuse overview typography, panel insets and controls at two window sizes', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Cluster', exact: true }).click();
  const panel = page.getByRole('complementary', { name: 'Cluster panel' });
  for (const width of [1280, 1000]) {
    await page.setViewportSize({ width, height: 720 });
    await page.getByRole('button', { name: 'Cluster panel', exact: true }).click();
    await expect(panel).toHaveCSS('padding', '18px');
    await expect(panel).toHaveCSS('border-radius', '22px');
    const baseline = await panel.evaluate((element) => {
      const heading = element.querySelector('h2');
      const section = element.querySelector('h3');
      const description = element.querySelector('p');
      const details = element.querySelector('dt');
      const closeIcon = element.querySelector('button[aria-label="Close cluster panel"] svg');
      if (!heading || !section || !description || !details || !closeIcon)
        throw new Error('Panel roles missing');
      return {
        title: getComputedStyle(heading).fontSize,
        section: getComputedStyle(section).fontSize,
        description: getComputedStyle(description).fontSize,
        metadata: getComputedStyle(details).fontSize,
        icon: closeIcon.getBoundingClientRect().width,
      };
    });
    expect(baseline).toEqual({
      title: '18px',
      section: '16px',
      description: '13px',
      metadata: '12px',
      icon: 18,
    });
    const cards = await page.getByRole('article').evaluateAll((elements) =>
      elements.map((element) => {
        const { x, y, width, height } = element.getBoundingClientRect();
        return { x, y, width, height };
      }),
    );
    await page.mouse.move(0, 0);
    await page.screenshot({ path: `test-results/cluster-requests-${width}.png` });
    for (const name of ['Add device', 'Join cluster', 'Share this PC']) {
      await page.getByRole('button', { name: 'Add', exact: true }).click();
      await page.getByRole('menuitem', { name, exact: true }).click();
      await expect(panel.getByRole('heading', { name, exact: true })).toHaveCSS(
        'font-size',
        baseline.title,
      );
      await expect(panel.locator('h3').first()).toHaveCSS('font-size', baseline.section);
      await expect(panel.locator('p').first()).toHaveCSS('font-size', baseline.description);
      await expect(panel).toHaveCSS('padding', '18px');
      await expect(panel).toHaveCSS('border-radius', '22px');
      const containment = await panel.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const viewport = element.querySelector('[role="region"]');
        if (!viewport) throw new Error('Panel scroll viewport missing');
        const inner = viewport.getBoundingClientRect();
        return {
          right: bounds.right,
          bottom: bounds.bottom,
          topInset: inner.top - bounds.top,
          bottomInset: bounds.bottom - inner.bottom,
          overflow: viewport.scrollWidth - viewport.clientWidth,
        };
      });
      expect(containment.right).toBeLessThan(width);
      expect(containment.bottom).toBeLessThan(720);
      expect(containment.topInset).toBeGreaterThanOrEqual(18);
      expect(containment.bottomInset).toBeGreaterThanOrEqual(18);
      expect(containment.overflow).toBeLessThanOrEqual(1);
      expect(
        await page.getByRole('article').evaluateAll((elements) =>
          elements.map((element) => {
            const { x, y, width, height } = element.getBoundingClientRect();
            return { x, y, width, height };
          }),
        ),
      ).toEqual(cards);
      if (name === 'Share this PC') {
        const toggle = panel.getByRole('switch');
        await expect(toggle).toHaveCSS('width', '28px');
        await expect(toggle).toHaveCSS('height', '16px');
        if ((await toggle.getAttribute('aria-checked')) !== 'true') await toggle.click();
        await expect(toggle).toHaveCSS('background-color', 'rgb(72, 127, 255)');
      }
      await page.mouse.move(0, 0);
      await page.screenshot({
        path: `test-results/cluster-${name.toLowerCase().replaceAll(' ', '-')}-${width}.png`,
      });
    }
    await panel.getByRole('button', { name: 'Close cluster panel' }).click();
  }
});

test('incoming decision count and manual request status are usable without changing placement', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Cluster', exact: true }).click();
  await page.getByRole('button', { name: 'Cluster panel', exact: true }).click();
  const panel = page.getByRole('complementary', { name: 'Cluster panel' });
  await panel.getByRole('button', { name: 'Approve invitation from render-coordinator' }).click();
  await expect(panel.getByRole('heading', { name: 'Pending requests 1' })).toBeFocused();
  await expect(page.getByLabel('1 pending request')).toBeVisible();
  await panel.getByRole('button', { name: 'Decline join request from office-pc' }).click();
  await expect(page.getByLabel(/pending requests?$/)).toHaveCount(0);
  await expect(page.getByRole('article')).toHaveCount(4);
  await expect(page.getByText(/^Layers /)).toHaveCount(5);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Add device', exact: true }).click();
  const input = panel.getByRole('textbox', { name: 'Private address' });
  await input.fill('<script>sample</script>');
  await input.press('Enter');
  await expect(panel.getByRole('status')).toHaveText('Invitation pending · demo');
  await expect(input).toHaveValue('<script>sample</script>');
  await expect(page.getByRole('article')).toHaveCount(4);
  await input.fill('192.168.1.24');
  await expect(panel.getByRole('button', { name: 'Invite private address' })).toBeEnabled();
});
