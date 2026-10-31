import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

async function expectNativeScrollbar(page: Page, scroller: Locator) {
  await scroller.scrollIntoViewIfNeeded();
  await page.mouse.move(0, 0);
  await expect(scroller).toHaveCSS('scrollbar-width', 'thin');
  await expect(scroller).toHaveCSS(
    'scrollbar-color',
    'rgba(252, 252, 252, 0.082) rgba(0, 0, 0, 0)',
  );
  expect(
    await scroller.evaluate((node) => {
      const style = getComputedStyle(node, '::-webkit-scrollbar-track');
      return [style.marginTop, style.marginBottom];
    }),
  ).toEqual(['0px', '0px']);
  await scroller.hover();
  await expect(scroller).toHaveCSS(
    'scrollbar-color',
    'rgba(252, 252, 252, 0.157) rgba(0, 0, 0, 0)',
  );
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('Chat history, transcript and composer use native scrollbars', async ({ page }) => {
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await expectNativeScrollbar(page, page.getByRole('navigation', { name: 'Conversation history' }));
  await expectNativeScrollbar(page, page.getByRole('region', { name: 'Messages' }));
  const composer = page.getByRole('textbox', { name: 'Message', exact: true });
  await composer.fill(Array(20).fill('Scrollbar input fixture').join('\n'));
  await expectNativeScrollbar(page, composer);
  expect(await composer.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
});

test('Models, configuration fields, dropdowns and dialogs share native scrollbars', async ({
  page,
}) => {
  await expectNativeScrollbar(page, page.getByRole('main'));
  await page.getByRole('button', { name: 'Explore models', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Model downloads', exact: true });
  await expectNativeScrollbar(page, dialog);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Configure Qwen3.8-27B', exact: true }).click();
  const scroller = page.locator('[data-configuration-scroll]');
  const actions = page.getByRole('group', { name: 'Model configuration actions' });
  const footer = await actions.boundingBox();
  await expectNativeScrollbar(page, scroller);
  await expectNativeScrollbar(
    page,
    page.getByRole('textbox', { name: 'System Prompt', exact: true }),
  );
  await page.getByRole('combobox', { name: 'Context Overflow', exact: true }).click();
  await expectNativeScrollbar(
    page,
    page.getByRole('listbox', { name: 'Context Overflow', exact: true }),
  );
  await page.keyboard.press('Escape');
  await scroller.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  expect(await actions.boundingBox()).toEqual(footer);
  await expect(actions.getByRole('button', { name: 'Save changes', exact: true })).toBeInViewport();
});

test('API page, code examples and logs retain separate native scroll areas', async ({ page }) => {
  await page.getByRole('button', { name: 'API', exact: true }).click();
  const main = page.getByRole('main');
  await expectNativeScrollbar(page, main);
  for (const viewer of [
    page.getByRole('tabpanel', { name: 'Python', exact: true }),
    page.getByRole('log', { name: 'Runtime log viewer' }),
  ]) {
    await expectNativeScrollbar(page, viewer);
    await expect(viewer).toHaveCSS('overscroll-behavior', 'contain');
    const outer = await main.evaluate((node) => node.scrollTop);
    await viewer.evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    expect(await main.evaluate((node) => node.scrollTop)).toBe(outer);
  }
});

test('Cluster navigation, model picker and inspector use native scrollbars', async ({ page }) => {
  await page.getByRole('button', { name: 'Cluster', exact: true }).click();
  const sidebar = page.getByRole('complementary', { name: 'Cluster', exact: true });
  await expectNativeScrollbar(
    page,
    sidebar
      .locator('div')
      .filter({ has: page.getByRole('navigation', { name: 'Cluster navigation' }) })
      .first(),
  );
  await page.getByRole('button', { name: /Choose model|Selected demo model:/ }).click();
  await expectNativeScrollbar(page, page.getByRole('menu', { name: 'Model library' }));
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Select studio-desktop', exact: true }).click();
  const panel = page.getByRole('complementary', { name: 'Cluster panel', exact: true });
  const content = panel.getByRole('region', { name: 'Cluster panel content' });
  await expectNativeScrollbar(page, content);
  await content.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  expect(await panel.evaluate((node) => node.scrollTop)).toBe(0);
});
