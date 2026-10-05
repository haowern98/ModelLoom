import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page
    .getByRole('complementary', { name: 'Main navigation' })
    .getByRole('button', { name: 'Chat', exact: true })
    .click();
});

test('conversation selection, search, per-chat drafts and feedback survive navigation', async ({
  page,
}) => {
  await expect(page.getByRole('heading', { name: 'Planning a local setup' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('My setup draft');
  await page.getByRole('button', { name: 'Explain model quantization', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('');
  await page.getByRole('button', { name: 'Good response 2' }).click();
  await expect(page.getByRole('button', { name: 'Good response 2' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Bad response 2' }).click();
  await expect(page.getByRole('button', { name: 'Good response 2' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await page.getByRole('button', { name: 'Models', exact: true }).click();
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Bad response 2' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Planning a local setup', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue(
    'My setup draft',
  );
  await page.getByRole('button', { name: 'Search conversations' }).click();
  const search = page.getByRole('searchbox', { name: 'Search chats' });
  await expect(search).toBeFocused();
  await search.fill('Q4_K_M');
  await expect(
    page.getByRole('navigation', { name: 'Conversation history' }).getByRole('button'),
  ).toHaveCount(1);
  await search.fill('no such conversation');
  await expect(page.getByText('No matching conversations')).toBeVisible();
  await search.press('Escape');
  await expect(page.getByRole('button', { name: 'Search conversations' })).toBeFocused();
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

test('layout matches the three flat surfaces and contains text at supported desktop widths', async ({
  page,
}) => {
  const sidebar = page.getByRole('complementary', { name: 'Conversations' });
  const chat = page.getByRole('region', { name: 'Chat', exact: true });
  const main = page.getByRole('main');
  await expect(sidebar).toHaveCSS('background-color', 'rgb(28, 28, 28)');
  await expect(sidebar).toHaveCSS('border-right-width', '1px');
  await expect(sidebar).toHaveCSS('border-right-color', 'rgb(48, 48, 51)');
  await expect(sidebar).toHaveCSS('border-top-right-radius', '0px');
  await expect(chat).toHaveCSS('background-color', 'rgb(24, 24, 24)');
  await expect(main).toHaveCSS('padding', '0px');
  await expect(page.getByRole('region', { name: 'ModelLoom workspace' })).toHaveCSS(
    'border-top-left-radius',
    '16px',
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
  const text = await page
    .getByRole('article', { name: 'Assistant response 2' })
    .locator('p')
    .innerText();
  await page.getByRole('button', { name: 'Copy response 2' }).click();
  await expect(page.getByRole('status')).toHaveText('Response copied');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  // Windows clipboard text uses CRLF; compare the exact content with normalized line endings.
  expect(copied.replace(/\r\n/g, '\n')).toBe(text);
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
