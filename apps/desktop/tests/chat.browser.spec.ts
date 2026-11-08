import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page
    .getByRole('complementary', { name: 'Main navigation' })
    .getByRole('button', { name: 'Chat', exact: true })
    .click();
});

test('long chat titles fade, reveal a fixed action menu and scroll only during hover or keyboard focus', async ({
  page,
}) => {
  const title =
    'A very long saved conversation title that must reveal its complete ending when hovered';
  await page.addInitScript((title) => {
    window.modelLoomRuntime = {
      command: () => Promise.resolve({ enabled: true, model: null, phase: 'stopped', error: null }),
    };
    window.modelLoomChat = {
      subscribe: () => () => undefined,
      command: (command) =>
        Promise.resolve({
          ok: true,
          page: {
            next: null,
            revision: 0,
            payload: JSON.stringify(
              command.action === 'list'
                ? [{ id: 'long', title, revision: 0, updated: Date.now() }]
                : { id: 'long', title, draft: '', revision: 0, turns: [] },
            ),
          },
        }),
    };
  }, title);
  await page.reload();
  await page
    .getByRole('complementary', { name: 'Main navigation' })
    .getByRole('button', { name: 'Chat', exact: true })
    .click();
  const row = page.locator('[data-conversation-id="long"]'),
    selection = row.getByRole('button', { name: title, exact: true });
  const more = row.getByRole('button', { name: `Chat actions: ${title}` });
  const viewport = selection.locator('span').first(),
    text = viewport.locator('span');
  for (const width of [1280, 1100, 1000]) {
    await page.setViewportSize({ width, height: 720 });
    await page.mouse.move(width - 10, 100);
    await expect(more).toBeHidden();
    await expect(viewport).toHaveAttribute('data-overflow', 'true');
    expect(await viewport.evaluate((node) => getComputedStyle(node).maskImage)).toContain(
      'linear-gradient',
    );
    await expect(text).toHaveCSS('animation-name', 'none');
    await row.hover();
    await expect(more).toBeVisible();
    const before = await more.boundingBox();
    await expect.poll(() => text.evaluate((node) => node.getAnimations().length)).toBe(1);
    await text.evaluate((node) => {
      const animation = node.getAnimations()[0]!;
      const timing = animation.effect!.getTiming();
      animation.currentTime = Number(timing.duration) / 2 + Number(timing.delay);
    });
    await expect
      .poll(() => text.evaluate((node) => new DOMMatrix(getComputedStyle(node).transform).m41))
      .toBeLessThan(-10);
    const after = await more.boundingBox();
    expect(after?.x).toBe(before?.x);
    expect(after?.y).toBe(before?.y);
    expect((await viewport.boundingBox())!.x + (await viewport.boundingBox())!.width).toBeLessThan(
      before!.x,
    );
    await page.screenshot({ path: `test-results/chat-title-hover-${width}.png` });
    await page.mouse.move(width - 10, 100);
    await expect(text).toHaveCSS('animation-name', 'none');
    await expect(text).toHaveCSS('transform', 'none');
  }
  await selection.focus();
  await expect(selection).toBeFocused();
  await expect(more).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(more).toBeFocused();
  await page.keyboard.press('Enter');
  await page.getByRole('menuitem', { name: 'Delete chat' }).press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Delete chat?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(selection).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await row.hover();
  await expect(text).toHaveCSS('animation-name', 'none');
});

test('measured speed labels align with Copy and Retry at supported widths', async ({ page }) => {
  await page.addInitScript(() => {
    window.modelLoomRuntime = {
      command: () => Promise.resolve({ enabled: true, model: null, phase: 'ready', error: null }),
    };
    window.modelLoomChat = {
      subscribe: () => () => undefined,
      command: (command) =>
        Promise.resolve({
          ok: true,
          page: {
            next: null,
            revision: 1,
            payload: JSON.stringify(
              command.action === 'list'
                ? [
                    {
                      id: 'fixture',
                      title: 'Speed layout fixture',
                      revision: 1,
                      updated: Date.now(),
                    },
                  ]
                : {
                    id: 'fixture',
                    title: 'Speed layout fixture',
                    draft: '',
                    revision: 1,
                    turns: [
                      {
                        id: 'turn',
                        text: 'Synthetic prompt',
                        attempts: [
                          {
                            id: 'attempt',
                            requestId: 'request',
                            state: 'completed',
                            text: 'Synthetic answer',
                            reasoning: '',
                            outcome: { status: 'completed', reason: 'STOP' },
                            speeds: { generation: 24.8, prefill: 1420 },
                          },
                        ],
                      },
                    ],
                  },
            ),
          },
        }),
    };
  });
  await page.reload();
  await page
    .getByRole('complementary', { name: 'Main navigation' })
    .getByRole('button', { name: 'Chat', exact: true })
    .click();
  const generation = page.getByText('Generation: 24.80 tok/s');
  const prefill = page.getByText('Prompt processing: 1420.00 tok/s');
  const retry = page.getByRole('button', { name: 'Retry response 2' });
  await expect(generation).toHaveCSS('font-size', '12px');
  await expect(generation).toHaveCSS('color', 'rgb(171, 171, 171)');
  await expect(generation).toHaveCSS('font-weight', '400');
  await expect(page.getByRole('button', { name: /Good response|Bad response/ })).toHaveCount(0);
  for (const width of [1280, 1100, 1000]) {
    await page.setViewportSize({ width, height: 720 });
    const r = await retry.boundingBox(),
      g = await generation.boundingBox(),
      p = await prefill.boundingBox();
    if (!r || !g || !p) throw new Error('Missing response metrics');
    expect(g.x).toBeGreaterThan(r.x + r.width);
    expect(p.x).toBeGreaterThan(g.x + g.width);
    expect(Math.abs(r.y + r.height / 2 - (g.y + g.height / 2))).toBeLessThan(1);
    expect(p.y).toBe(g.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `test-results/chat-speeds-${width}.png` });
  }
});

test('conversation selection, search and per-chat drafts survive navigation', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Planning a local setup' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('My setup draft');
  await page.getByRole('button', { name: 'Explain model quantization', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('');
  await expect(page.getByRole('button', { name: /Good response|Bad response/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Models', exact: true }).click();
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await expect(page.getByRole('button', { name: /Good response|Bad response/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Planning a local setup', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue(
    'My setup draft',
  );
  await page.getByRole('button', { name: 'Search chats' }).click();
  const search = page.getByRole('searchbox', { name: 'Search chats' });
  await expect(search).toBeFocused();
  await search.fill('Q4_K_M');
  const popup = page.getByRole('dialog', { name: 'Search chats' });
  await expect(popup.getByRole('option')).toHaveCount(1);
  await expect(
    page.locator('aside[aria-label="Conversations"] [data-conversation-id]'),
  ).toHaveCount(4);
  await search.fill('no such conversation');
  await expect(popup.getByText('No matching chats')).toBeVisible();
  await search.press('Escape');
  await expect(page.getByRole('button', { name: 'Search chats' })).toBeFocused();
  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  const draft = page.getByRole('textbox', { name: 'Message', exact: true });
  await expect(draft).toBeFocused();
  await expect(draft).toHaveValue('');
  await draft.fill('<script>window.secret = true</script>');
  await page.getByRole('button', { name: 'Planning a local setup', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Conversation history' })
    .getByRole('button', { name: 'New chat', exact: true })
    .click();
  await expect(draft).toHaveValue('<script>window.secret = true</script>');
  expect(await page.evaluate(() => Reflect.has(window, 'secret'))).toBe(false);
});

test('layout uses separate workspace surfaces and contains text at supported desktop widths', async ({
  page,
}) => {
  const sidebar = page.getByRole('complementary', { name: 'Conversations' });
  const chat = page.getByRole('region', { name: 'Chat', exact: true });
  const main = page.getByRole('main');
  await expect(sidebar).toHaveCSS('background-color', 'rgba(17, 17, 17, 0.65)');
  await expect(sidebar).toHaveCSS('border-right-width', '1px');
  await expect(sidebar).toHaveCSS('border-right-color', 'rgb(48, 48, 51)');
  await expect(sidebar).toHaveCSS('border-top-right-radius', '0px');
  await expect(chat).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(chat.locator('header').locator('..')).toHaveCSS(
    'background-color',
    'rgb(17, 17, 17)',
  );
  await expect(main).toHaveCSS('padding', '0px');
  await expect(page.getByRole('region', { name: 'ModelLoom workspace' })).toHaveCSS(
    'border-top-left-radius',
    '12px',
  );
  await expect(page.getByRole('complementary')).toHaveCount(2);
  await expect(page.getByText('ChatGPT', { exact: true })).toHaveCount(0);
  for (const font of ['system', 'Arial']) {
    if (font === 'Arial')
      await page.addStyleTag({ content: ':root { font-family: Arial, sans-serif; }' });
    for (const width of [1280, 1100, 1000]) {
      await page.setViewportSize({ width, height: width === 1000 ? 620 : 720 });
      await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeInViewport();
      await expect(page.getByRole('button', { name: 'Send message' })).toBeInViewport();
      const header = await page
        .getByRole('heading', { name: 'Planning a local setup' })
        .boundingBox();
      const sidebarBounds = await sidebar.boundingBox();
      if (!header || !sidebarBounds) throw new Error('Missing Chat layout');
      expect(header.x).toBeGreaterThan(sidebarBounds.x + sidebarBounds.width);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({ path: `test-results/chat-${font}-${width}.png` });
    }
  }
});

test('copy is explicit, unavailable attachments are disclosed and model selection stays in Cluster', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const paragraphs = await page
    .getByRole('article', { name: 'Assistant response 2' })
    .locator('p')
    .allInnerTexts();
  await page.getByRole('button', { name: 'Copy response 2' }).click();
  await expect(page.getByRole('status')).toHaveText('Response copied');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  // Windows clipboard text uses CRLF; compare the exact content with normalized line endings.
  expect(copied.replace(/\r\n/g, '\n')).toBe(paragraphs.join('\n\n'));
  await expect(page.getByRole('button', { name: 'Attachments unavailable' })).toBeDisabled();
  await page
    .getByRole('textbox', { name: 'Message', exact: true })
    .fill('This must not start a model request');
  await expect(page.getByRole('button', { name: 'Send message' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Send message' })).toHaveAttribute(
    'title',
    'Sending is not available yet',
  );
  await expect(page.getByRole('article')).toHaveCount(2);
  const model = page.getByRole('button', { name: 'Chat model: Qwen3.8-27B' });
  await model.click();
  await expect(page.getByRole('button', { name: 'Choose model in Cluster' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(model).toBeFocused();
  await expect(model).toHaveAttribute('aria-expanded', 'false');
  await model.click();
  await page.getByRole('button', { name: 'Choose model in Cluster' }).click();
  await expect(page.getByRole('heading', { name: 'Cluster', exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Selected demo model: Qwen3.8-27B' }),
  ).toBeVisible();
});
