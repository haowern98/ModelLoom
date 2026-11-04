import { expect, test } from '@playwright/test';
import type { mountDropdown } from './fixtures/dropdown-scrollbars';

test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

for (const kind of ['configuration', 'cluster'] as const) {
  for (const bottom of [false, true]) {
    test(`${kind} dropdown scrolls within the ${bottom ? 'bottom' : 'top'} window edge`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1000, height: 900 });
      await page.goto('/');
      await page.evaluate(
        async ({ kind, bottom }) => {
          const path = '/tests/fixtures/dropdown-scrollbars.tsx';
          const fixture = (await import(path)) as { mountDropdown: typeof mountDropdown };
          fixture.mountDropdown(kind, bottom);
        },
        { kind, bottom },
      );
      const trigger =
        kind === 'configuration'
          ? page.getByRole('combobox', { name: 'Dropdown fixture' })
          : page.getByRole('button', { name: 'Choose model', exact: true });
      await trigger.click();
      const menu = page.getByRole(kind === 'configuration' ? 'listbox' : 'menu');
      await expect(menu).toHaveCSS('padding', '4px');
      await expect(menu).toHaveCSS('border-radius', '16px');
      await expect(menu).toHaveCSS('scrollbar-width', 'thin');
      await page.mouse.move(0, 0);
      await expect(menu).toHaveCSS(
        'scrollbar-color',
        'rgba(252, 252, 252, 0.082) rgba(0, 0, 0, 0)',
      );
      await menu.hover();
      await expect(menu).toHaveCSS(
        'scrollbar-color',
        'rgba(252, 252, 252, 0.157) rgba(0, 0, 0, 0)',
      );
      const bounds = (await menu.boundingBox())!;
      const button = (await trigger.boundingBox())!;
      expect(bounds.height).toBeGreaterThan(380);
      expect(bounds.x).toBeGreaterThanOrEqual(6);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(994);
      expect(bounds.y).toBeGreaterThanOrEqual(6);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(894);
      if (bottom) expect(bounds.y + bounds.height).toBeLessThan(button.y);
      else expect(bounds.y).toBeGreaterThan(button.y + button.height);
      expect(await menu.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
      const outerScroll = await page.evaluate(() => document.scrollingElement!.scrollTop);
      await page.keyboard.press('End');
      const last = menu.getByRole(kind === 'configuration' ? 'option' : 'menuitem').last();
      await expect(last).toBeFocused();
      await expect(last).toBeInViewport();
      expect(await menu.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
      await page.keyboard.press('Home');
      await expect(
        menu.getByRole(kind === 'configuration' ? 'option' : 'menuitem').first(),
      ).toBeInViewport();
      expect(await page.evaluate(() => document.scrollingElement!.scrollTop)).toBe(outerScroll);
      await page.setViewportSize({ width: 640, height: 500 });
      await expect
        .poll(async () => {
          const resized = (await menu.boundingBox())!;
          return (
            resized.y >= 6 && resized.y + resized.height <= 494 && resized.x + resized.width <= 634
          );
        })
        .toBe(true);
      await page.screenshot({ path: test.info().outputPath('dropdown.png') });
      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);
      await expect(trigger).toBeFocused();
    });
  }
}
