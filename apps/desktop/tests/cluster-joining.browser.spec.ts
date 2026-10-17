import { expect, test } from '@playwright/test';

test('cluster sidebar supports keyboard activation of discovery and connection contexts', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Cluster', exact: true }).click();
  const navigation = page.getByRole('navigation', { name: 'Cluster navigation' });
  const add = navigation.getByRole('button', { name: 'Add device', exact: true });
  await add.focus();
  await page.keyboard.press('Enter');
  await expect(add).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { name: 'Add device', exact: true })).toBeVisible();
  await expect(page.getByRole('menu')).toHaveCount(0);
  await navigation.getByRole('button', { name: 'Connections', exact: true }).focus();
  await page.keyboard.press('Space');
  await page.getByRole('button', { name: 'Join cluster', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Join cluster', exact: true })).toBeVisible();
  await navigation.getByRole('button', { name: 'Overview', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Cluster panel', exact: true })).toBeVisible();
});

test('joining pages preserve typography and keep controls reachable at two window sizes', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Cluster', exact: true }).click();
  const navigation = page.getByRole('navigation', { name: 'Cluster navigation' });
  for (const width of [1280, 1000]) {
    await page.setViewportSize({ width, height: 720 });
    for (const name of ['Add device', 'Join cluster', 'Share this PC']) {
      if (name === 'Add device') {
        await navigation.getByRole('button', { name, exact: true }).click();
      } else {
        await navigation.getByRole('button', { name: 'Connections', exact: true }).click();
        await page.getByRole('button', { name, exact: true }).click();
      }
      const content = page.getByRole('region', { name, exact: true });
      await expect(content.getByRole('heading', { name, exact: true })).toHaveCSS(
        'font-size',
        '24px',
      );
      await expect(content.locator('h3').first()).toHaveCSS('font-size', '16px');
      await expect(content.locator('p').first()).toHaveCSS('font-size', '13px');
      const bounds = await content.boundingBox();
      if (!bounds) throw new Error('Joining page missing');
      expect(bounds.x).toBeGreaterThan(240);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      expect(
        await content.evaluate((element) => element.scrollWidth - element.clientWidth),
      ).toBeLessThanOrEqual(1);
      if (name === 'Share this PC') {
        const toggle = content.getByRole('switch');
        await expect(toggle).toHaveCSS('width', '28px');
        await expect(toggle).toHaveCSS('height', '16px');
        if ((await toggle.getAttribute('aria-checked')) !== 'true') await toggle.click();
        await expect(toggle).toHaveCSS('background-color', 'rgb(72, 127, 255)');
      } else {
        for (const mode of ['LAN', 'Tailscale', 'Headscale']) {
          await content.getByRole('button', { name: mode, exact: true }).click();
          await expect(content.getByRole('button', { name: mode, exact: true })).toHaveAttribute(
            'aria-pressed',
            'true',
          );
        }
        const manual = content.getByRole('button', { name: 'Connect manually', exact: true });
        if ((await manual.getAttribute('aria-expanded')) !== 'true') await manual.click();
        await expect(content.getByRole('textbox', { name: 'Private address' })).toBeFocused();
        await expect(content.getByRole('textbox', { name: 'Private address' })).toBeInViewport();
      }
      await page.mouse.move(0, 0);
      await page.screenshot({
        path: `test-results/cluster-${name.toLowerCase().replaceAll(' ', '-')}-${width}.png`,
      });
    }
  }
});

test('incoming decisions and manual request status remain simulated without changing placement', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Cluster', exact: true }).click();
  const navigation = page.getByRole('navigation', { name: 'Cluster navigation' });
  await navigation.getByRole('button', { name: /^Requests/ }).click();
  const requests = page.getByRole('region', { name: 'Requests', exact: true });
  await requests
    .getByRole('button', { name: 'Approve invitation from render-coordinator' })
    .click();
  await expect(requests.getByRole('heading', { name: 'Pending requests 1' })).toBeFocused();
  await expect(page.getByLabel('1 pending request', { exact: true })).toBeVisible();
  await requests.getByRole('button', { name: 'Decline join request from office-pc' }).click();
  await expect(page.getByLabel(/pending requests?$/)).toHaveCount(0);
  await navigation.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(4);
  await expect(page.getByText(/^Layers /)).toHaveCount(5);
  await navigation.getByRole('button', { name: 'Add device', exact: true }).click();
  const add = page.getByRole('region', { name: 'Add device', exact: true });
  await add.getByRole('button', { name: 'Connect manually', exact: true }).click();
  const input = add.getByRole('textbox', { name: 'Private address' });
  await input.fill('<script>sample</script>');
  await input.press('Enter');
  await expect(add.getByRole('status')).toHaveText('Invitation pending · demo');
  await expect(input).toHaveValue('<script>sample</script>');
  await input.fill('192.168.1.24');
  await expect(add.getByRole('button', { name: 'Invite private address' })).toBeEnabled();
  await navigation.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(4);
  await expect(page.getByText(/^Layers /)).toHaveCount(5);
});
