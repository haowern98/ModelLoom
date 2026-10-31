import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
});

test('Chat header, collapsible groups and action menu match the approved navigation', async ({
  page,
}) => {
  const sidebar = page.getByRole('complementary', { name: 'Conversations' });
  await expect(sidebar).toHaveCSS('width', '238px');
  await expect(sidebar.getByRole('heading', { name: 'Chat', exact: true })).toBeVisible();
  const search = sidebar.getByRole('button', { name: 'Search chats' });
  const newChat = sidebar.getByRole('button', { name: 'New chat', exact: true }).first();
  expect((await newChat.boundingBox())!.y).toBeGreaterThan((await search.boundingBox())!.y);
  await expect(newChat).toHaveCSS('height', '30px');
  expect(
    await newChat.evaluate((node) => {
      const title = node.closest('aside')!.querySelector('h2')!;
      const titleRange = document.createRange();
      titleRange.selectNodeContents(title);
      const label = [...node.childNodes].find(
        (child) => child.nodeType === Node.TEXT_NODE && child.textContent?.trim(),
      )!;
      const labelRange = document.createRange();
      labelRange.selectNodeContents(label);
      return labelRange.getBoundingClientRect().top - titleRange.getBoundingClientRect().bottom;
    }),
  ).toBe(24);
  await expect(newChat).toHaveCSS('font-size', '14px');
  await expect(newChat.locator('svg')).toHaveCSS('width', '16px');
  await expect(newChat.locator('svg')).toHaveCSS('height', '16px');
  await expect(newChat.locator('svg')).toHaveAttribute('viewBox', '0 0 16 16');
  const today = sidebar.getByRole('button', { name: 'Today', exact: true });
  await expect(today).toHaveCSS('font-size', '14px');
  await expect(today).toHaveCSS('font-weight', '600');
  await page.mouse.move(0, 0);
  await expect(today.locator('svg')).toHaveCSS('opacity', '0');
  await today.hover();
  await expect(today.locator('svg')).toHaveCSS('opacity', '1');
  await expect(today.locator('svg')).toHaveCSS('width', '14px');
  await expect(today.locator('svg')).toHaveCSS('height', '14px');
  await expect(today.locator('svg')).toHaveAttribute('viewBox', '0 0 20 21');
  await expect(today.locator('path')).toHaveAttribute('stroke-width', '0.6');
  await today.click();
  await expect(today).toHaveAttribute('aria-expanded', 'false');
  await search.focus();
  await page.mouse.move(0, 0);
  await expect(today.locator('svg')).toHaveCSS('opacity', '1');
  await expect(today.locator('svg')).toHaveCSS('transform', 'matrix(0, -1, 1, 0, 0, 0)');
  await expect(
    sidebar.getByRole('button', { name: 'Planning a local setup', exact: true }),
  ).toHaveCount(0);
  await today.press('Enter');
  const row = sidebar.locator('[data-conversation-id="setup"]');
  await expect(row.getByRole('button', { name: 'Planning a local setup', exact: true })).toHaveCSS(
    'font-size',
    '14px',
  );
  const more = row.getByRole('button', { name: 'Chat actions: Planning a local setup' });
  await page.mouse.move(0, 0);
  await expect(more).toBeHidden();
  await row.hover();
  await more.click();
  const menu = page.getByRole('menu', { name: 'Chat actions: Planning a local setup' });
  await expect(menu.getByRole('menuitem')).toHaveText(['Pin', 'Archive', 'Delete chat']);
  await expect(menu).toHaveCSS('padding', '4px');
  await expect(menu).toHaveCSS('border-radius', '16px');
  await expect(menu.getByRole('menuitem', { name: 'Pin', exact: true })).toBeFocused();
  await page.keyboard.press('End');
  await expect(menu.getByRole('menuitem', { name: 'Delete chat' })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(menu.getByRole('menuitem', { name: 'Pin', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(more).toBeFocused();
  await more.click();
  await menu.getByRole('menuitem', { name: 'Pin', exact: true }).click();
  const pinned = sidebar.getByRole('region', { name: 'Pinned', exact: true });
  await expect(
    pinned.getByRole('button', { name: 'Planning a local setup', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Models', exact: true }).click();
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await expect(
    pinned.getByRole('button', { name: 'Planning a local setup', exact: true }),
  ).toBeVisible();
  await row.hover();
  await row.getByRole('button', { name: 'Archive chat: Planning a local setup' }).click();
  await expect(row).toHaveCount(0);
  await sidebar.getByRole('button', { name: 'Archived chats', exact: true }).click();
  await expect(row).toBeVisible();
  await row.hover();
  await row.getByRole('button', { name: 'Chat actions: Planning a local setup' }).click();
  await expect(menu.getByRole('menuitem')).toHaveText(['Unpin', 'Unarchive', 'Delete chat']);
  await menu.getByRole('menuitem', { name: 'Delete chat' }).click();
  await expect(page.getByRole('dialog', { name: 'Delete chat?' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await row.hover();
  await row.getByRole('button', { name: 'Unarchive chat: Planning a local setup' }).click();
  await sidebar.getByRole('button', { name: 'Back to chats' }).click();
  await expect(pinned).toBeVisible();
  await page.mouse.move(0, 0);
  await page.screenshot({ path: test.info().outputPath('chat-sidebar.png') });
});

test('header and Archived chats stay fixed while long chat history scrolls', async ({ page }) => {
  const sidebar = page.getByRole('complementary', { name: 'Conversations' });
  const newChat = sidebar.getByRole('button', { name: 'New chat', exact: true }).first();
  for (let index = 0; index < 18; index++) {
    await newChat.click();
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill(`Draft ${index}`);
  }
  const history = sidebar.getByRole('navigation', { name: 'Conversation history' });
  const header = await sidebar.getByRole('heading', { name: 'Chat', exact: true }).boundingBox();
  const archived = sidebar.getByRole('button', { name: 'Archived chats', exact: true });
  const footer = await archived.boundingBox();
  for (const width of [1280, 1000]) {
    await page.setViewportSize({ width, height: 720 });
    await history.evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    expect(await sidebar.getByRole('heading', { name: 'Chat', exact: true }).boundingBox()).toEqual(
      header,
    );
    expect(await archived.boundingBox()).toEqual(footer);
    await expect(archived).toBeInViewport();
    expect(await history.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
    expect(await sidebar.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  }
});

for (const width of [1280, 1000]) {
  test('chat search popup replaces inline search at ' + width + 'px', async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    const sidebar = page.locator('aside[aria-label="Conversations"]');
    const trigger = sidebar.getByRole('button', { name: 'Search chats' });
    await expect(trigger.locator('svg')).toHaveCSS('width', '16px');
    await expect(trigger.locator('svg')).toHaveCSS('height', '16px');
    await expect(trigger.locator('svg')).toHaveAttribute('viewBox', '0 0 16 16');
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Keep this draft');
    const archivedRow = sidebar.locator('[data-conversation-id="quantization"]');
    await archivedRow.hover();
    await archivedRow
      .getByRole('button', { name: 'Archive chat: Explain model quantization' })
      .click();
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Search chats' });
    const search = dialog.getByRole('searchbox', { name: 'Search chats' });
    await expect(search).toHaveAttribute('placeholder', 'Search chats');
    await expect(search).toHaveCSS('outline-style', 'none');
    await expect(search).toBeFocused();
    await expect(dialog).toHaveCSS('width', '768px');
    await expect(dialog).toHaveCSS('border-radius', '16px');
    await expect(dialog).toHaveCSS('backdrop-filter', 'blur(24px)');
    await expect(sidebar.locator('input[type="search"]')).toHaveCount(0);
    await expect(dialog.getByRole('tablist')).toHaveCount(0);
    await expect(dialog.getByText('Quick actions')).toHaveCount(0);
    await expect(dialog.getByRole('heading', { name: 'Chats' })).toBeVisible();
    await search.fill('Q4_K_M');
    await expect(dialog.getByRole('option')).toHaveCount(1);
    await expect(dialog.getByRole('option', { name: 'Explain model quantization' })).toBeVisible();
    await expect(sidebar.locator('[data-conversation-id]')).toHaveCount(3);
    await search.fill('No such chat');
    await expect(dialog.getByText('No matching chats')).toBeVisible();
    await search.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue(
      'Keep this draft',
    );
    await trigger.click();
    await expect(search).toHaveValue('');
    await expect(dialog.getByRole('option')).toHaveCount(4);
    await search.press('Shift+Tab');
    expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Tab');
    await expect(search).toBeFocused();
    await page.screenshot({ path: test.info().outputPath('chat-search-' + width + '.png') });
    await page.mouse.click(2, 2);
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.click();
    await search.press('End');
    await expect(dialog.getByRole('option').last()).toHaveAttribute('aria-selected', 'true');
    await search.press('Home');
    await expect(dialog.getByRole('option').first()).toHaveAttribute('aria-selected', 'true');
    await search.press('ArrowDown');
    await expect(
      dialog.getByRole('option', { name: 'Explain model quantization' }),
    ).toHaveAttribute('aria-selected', 'true');
    await search.press('Enter');
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole('heading', { name: 'Explain model quantization', exact: true }),
    ).toBeVisible();
    await expect(
      sidebar.getByRole('button', { name: 'Explain model quantization', exact: true }),
    ).toBeVisible();
    await sidebar.getByRole('button', { name: 'Back to chats' }).click();
    await sidebar.getByRole('button', { name: 'Planning a local setup', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue(
      'Keep this draft',
    );
  });
}

test('Chat typography and insets match Cluster at both desktop widths', async ({ page }) => {
  for (const width of [1280, 1000]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole('button', { name: 'Cluster', exact: true }).click();
    const cluster = page.getByRole('complementary', { name: 'Cluster', exact: true });
    const reference = await cluster.evaluate((node) => {
      const title = node.querySelector('h1')!;
      const heading = node.querySelector('h2')!;
      const row = node.querySelector('nav > button')!;
      const style = (el: Element) => {
        const css = getComputedStyle(el);
        return {
          size: css.fontSize,
          weight: css.fontWeight,
          line: css.lineHeight,
          padding: css.padding,
        };
      };
      const base = node.getBoundingClientRect(),
        titleBox = title.getBoundingClientRect();
      return {
        title: style(title),
        heading: style(heading),
        row: style(row),
        titleLeft: titleBox.left - base.left,
        titleTop: titleBox.top - base.top,
        rowLeft: row.getBoundingClientRect().left - base.left,
        followingMargin: getComputedStyle(
          node.querySelector('section[aria-label="Configurations"] h2')!,
        ).marginTop,
      };
    });
    await page.getByRole('button', { name: 'Chat', exact: true }).click();
    const chat = page.getByRole('complementary', { name: 'Conversations' });
    const title = chat.getByRole('heading', { name: 'Chat', exact: true });
    await expect(title).toHaveCSS('font-size', reference.title.size);
    await expect(title).toHaveCSS('font-weight', reference.title.weight);
    await expect(title).toHaveCSS('line-height', reference.title.line);
    const sidebarBox = (await chat.boundingBox())!,
      titleBox = (await title.boundingBox())!;
    expect(titleBox.x - sidebarBox.x).toBe(reference.titleLeft);
    expect(titleBox.y - sidebarBox.y).toBe(reference.titleTop);
    const heading = chat.getByRole('button', { name: 'Today', exact: true });
    await expect(heading).toHaveCSS('font-size', reference.heading.size);
    await expect(heading).toHaveCSS('font-weight', reference.heading.weight);
    await expect(heading).toHaveCSS('padding', reference.heading.padding);
    const row = chat.locator('[data-conversation-id="setup"] > button');
    await expect(row).toHaveCSS('font-size', reference.row.size);
    await expect(row).toHaveCSS('font-weight', reference.row.weight);
    await expect(row).toHaveCSS('line-height', reference.row.line);
    await expect(row).toHaveCSS('padding', reference.row.padding);
    const bounds = (await row.boundingBox())!;
    expect(bounds.x - sidebarBox.x).toBe(reference.rowLeft);
    expect(bounds.height).toBe(30);
    expect(bounds.x - sidebarBox.x + 12).toBe(18);
    expect(
      await row.evaluate((node) => {
        const parent = node.closest('nav')!,
          css = getComputedStyle(parent);
        const row = node.getBoundingClientRect(),
          nav = parent.getBoundingClientRect();
        return Math.round(nav.left + parent.clientWidth - parseFloat(css.paddingRight) - row.right);
      }),
    ).toBe(0);
    await expect(chat.locator('nav > section').nth(1)).toHaveCSS(
      'margin-top',
      reference.followingMargin,
    );
    await expect(chat.getByRole('button', { name: 'Archived chats', exact: true })).toHaveCSS(
      'font-size',
      reference.row.size,
    );
    await page.mouse.move(0, 0);
    await page.screenshot({ path: test.info().outputPath(`chat-cluster-spacing-${width}.png`) });
  }
});

test('chat search results scroll inside a short window and ignore composition Enter', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 400 });
  const sidebar = page.locator('aside[aria-label="Conversations"]');
  for (let index = 0; index < 14; index++) {
    await sidebar.getByRole('button', { name: 'New chat', exact: true }).first().click();
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Draft ' + index);
  }
  await sidebar.getByRole('button', { name: 'Search chats' }).click();
  const dialog = page.getByRole('dialog', { name: 'Search chats' }),
    input = dialog.getByRole('searchbox');
  const list = dialog.getByRole('listbox', { name: 'Chats' });
  expect(await list.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
  await input.dispatchEvent('keydown', { key: 'Enter', isComposing: true });
  await expect(dialog).toBeVisible();
  await input.press('End');
  await expect(dialog.getByRole('option').last()).toBeInViewport();
  expect(await list.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const bounds = (await dialog.boundingBox())!;
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(400);
});
