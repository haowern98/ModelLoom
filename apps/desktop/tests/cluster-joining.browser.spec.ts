import { expect, test } from '@playwright/test';

test('Connections supports keyboard navigation between the two flows', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Cluster', exact: true }).click();
  const navigation = page.getByRole('navigation', { name: 'Cluster navigation' });
  const connections = navigation.getByRole('button', { name: /^Connections/u });
  await connections.focus();
  await page.keyboard.press('Enter');
  await expect(connections).toHaveAttribute('aria-current', 'page');
  const share = page.getByRole('tab', { name: 'Share this PC' });
  await share.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Add device' })).toBeFocused();
  await expect(page.getByRole('tabpanel', { name: 'Add device' })).toBeVisible();
  await page.keyboard.press('Home');
  await expect(share).toBeFocused();
  await expect(page.getByRole('tabpanel', { name: 'Share this PC' })).toBeVisible();
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: 'Add device' })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(share).toBeFocused();
  await expect(
    page.getByRole('tablist', { name: 'Connection options' }).getByRole('tab'),
  ).toHaveCount(2);
  await expect(page.getByRole('heading', { name: 'Connections', exact: true })).toBeVisible();
  await expect(navigation.getByRole('button', { name: /^Requests/u })).toHaveCount(0);
  await navigation.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cluster panel', exact: true })).toBeVisible();
});

test('connection controls match the shared typography and sizes at two window widths', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Cluster', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Cluster navigation' })
    .getByRole('button', { name: /^Connections/u })
    .click();
  for (const width of [1280, 900]) {
    await page.setViewportSize({ width, height: 720 });
    for (const name of ['Add device', 'Share this PC']) {
      await page.getByRole('tab', { name, exact: true }).click();
      const content = page.getByRole('tabpanel', { name, exact: true });
      await expect(page.getByRole('heading', { name: 'Connections', exact: true })).toHaveCSS(
        'font-size',
        '24px',
      );
      await expect(content.locator('h2').first()).toHaveCSS('font-size', '14px');
      await expect(content.locator('p').first()).toHaveCSS('font-size', '13px');
      const bounds = await content.boundingBox();
      if (!bounds) throw new Error('Connection tab content missing');
      expect(bounds.x).toBeGreaterThan(240);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      expect(
        await content.evaluate((element) => element.scrollWidth - element.clientWidth),
      ).toBeLessThanOrEqual(1);
      if (name === 'Share this PC') {
        const toggle = content.getByRole('switch');
        await expect(toggle).toHaveCSS('width', '32px');
        await expect(toggle).toHaveCSS('height', '20px');
        expect(
          await toggle.evaluate((element) => getComputedStyle(element, '::before').width),
        ).toBe('16px');
        if (!(await toggle.isChecked())) await toggle.click();
        await expect(toggle).toHaveCSS('background-color', 'rgb(72, 127, 255)');
        for (const checkbox of await content.getByRole('checkbox').all()) {
          expect(
            await checkbox.evaluate((element) => getComputedStyle(element, '::before').width),
          ).toBe('16px');
          expect(
            await checkbox.evaluate(
              (element) => getComputedStyle(element, '::before').borderRadius,
            ),
          ).toBe('2px');
        }
      } else {
        const input = content.getByRole('textbox', { name: 'Private address' });
        await input.scrollIntoViewIfNeeded();
        await expect(input).toBeInViewport();
      }
      await page.mouse.move(0, 0);
      await page.screenshot({
        path:
          'test-results/connections-' +
          name.toLowerCase().replaceAll(' ', '-') +
          '-' +
          width +
          '.png',
      });
    }
  }
});

test('incoming decisions and manual request status stay simulated without changing placement', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Cluster', exact: true }).click();
  const navigation = page.getByRole('navigation', { name: 'Cluster navigation' });
  await navigation.getByRole('button', { name: /^Connections/u }).click();
  const requests = page.getByRole('tabpanel', { name: 'Share this PC', exact: true });
  await requests
    .getByRole('button', { name: 'Approve invitation from render-coordinator' })
    .click();
  await expect(requests.getByRole('heading', { name: 'Pending requests 1' })).toBeFocused();
  await expect(page.getByLabel('1 pending request', { exact: true })).toBeVisible();
  await requests.getByRole('button', { name: 'Decline invitation from office-pc' }).click();
  await expect(page.getByLabel(/pending requests?$/)).toHaveCount(0);
  await navigation.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(4);
  await expect(page.getByRole('button', { name: /^Edit layers for / })).toHaveCount(5);
  await navigation.getByRole('button', { name: /^Connections/u }).click();
  await page.getByRole('tab', { name: 'Add device' }).click();
  const add = page.getByRole('tabpanel', { name: 'Add device', exact: true });
  const input = add.getByRole('textbox', { name: 'Private address' });
  await input.fill('<script>sample</script>');
  await input.press('Enter');
  await expect(add.getByRole('status')).toHaveText('Invitation pending · demo');
  await expect(input).toHaveValue('<script>sample</script>');
  await input.fill('192.168.1.24');
  await expect(add.getByRole('button', { name: 'Invite private address' })).toBeEnabled();
  await navigation.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(4);
  await expect(page.getByRole('button', { name: /^Edit layers for / })).toHaveCount(5);
});
