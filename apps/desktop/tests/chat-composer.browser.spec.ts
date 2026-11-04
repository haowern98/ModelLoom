import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
});

test('composer grows, scrolls at its viewport cap and shrinks without an inner focus box', async ({
  page,
}) => {
  const input = page.getByRole('textbox', { name: 'Message', exact: true });
  await input.fill('A short draft');
  await expect(input).toHaveCSS('outline-style', 'none');
  const initial = (await input.boundingBox())!;
  const longDraft = Array.from({ length: 45 }, (_, i) => `Line ${i + 1} of a pasted draft`).join(
    '\n',
  );
  await input.fill(longDraft);
  await expect
    .poll(async () => (await input.boundingBox())!.height)
    .toBeGreaterThan(initial.height);
  expect((await input.boundingBox())!.height).toBeLessThanOrEqual(
    page.viewportSize()!.height / 4 + 1,
  );
  expect(await input.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
  await input.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  expect(await input.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  await input.fill('Short again');
  await expect.poll(async () => (await input.boundingBox())!.height).toBe(initial.height);
  await expect(page.getByRole('button', { name: 'Expand message editor' })).toHaveCount(0);
});

test('multiline draft expands and collapses with controls reachable in short windows', async ({
  page,
}) => {
  const input = page.getByRole('textbox', { name: 'Message', exact: true });
  await input.fill('First line\nSecond line');
  const compact = (await input.boundingBox())!.height;
  await input.evaluate((node) => {
    if (!(node instanceof HTMLTextAreaElement)) throw new Error('Missing message editor');
    node.setSelectionRange(3, 8);
  });
  const expand = page.getByRole('button', { name: 'Expand message editor' });
  await expand.click();
  const collapse = page.getByRole('button', { name: 'Collapse message editor' });
  await expect(collapse).toHaveAttribute('aria-pressed', 'true');
  await expect(input).toBeFocused();
  await expect.poll(async () => (await input.boundingBox())!.height).toBeGreaterThan(compact);
  await expect(input).toHaveValue('First line\nSecond line');
  expect(
    await input.evaluate((node) => {
      if (!(node instanceof HTMLTextAreaElement)) throw new Error('Missing message editor');
      return [node.selectionStart, node.selectionEnd];
    }),
  ).toEqual([3, 8]);
  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 1000, height: 480 },
  ]) {
    await page.setViewportSize(viewport);
    const model = page.getByRole('button', { name: /^Chat model:/ });
    const send = page.getByRole('button', { name: 'Send message', exact: true });
    await expect(model).toBeVisible();
    await expect(send).toBeVisible();
    expect((await send.boundingBox())!.y + (await send.boundingBox())!.height).toBeLessThan(
      viewport.height,
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await expect(input).toHaveValue('First line\nSecond line');
    await page.screenshot({ path: test.info().outputPath(`expanded-${viewport.width}.png`) });
  }
  await collapse.click();
  await expect(expand).toHaveAttribute('aria-pressed', 'false');
  await expect(input).toBeFocused();
  await expect.poll(async () => (await input.boundingBox())!.height).toBe(compact);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(input.locator('xpath=../../..')).toHaveCSS('transition-duration', '0s');
  await page.screenshot({ path: test.info().outputPath('compact.png') });
});

test('wrapped text offers expansion and saved drafts resize on navigation', async ({ page }) => {
  const input = page.getByRole('textbox', { name: 'Message', exact: true });
  const draft = 'A long wrapped draft without manual newlines. '.repeat(100);
  await input.fill(draft);
  await expect(page.getByRole('button', { name: 'Expand message editor' })).toBeVisible();
  await page.getByRole('button', { name: 'Models', exact: true }).click();
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await expect(input).toHaveValue(draft);
  await expect(page.getByRole('button', { name: 'Expand message editor' })).toBeVisible();
  await page
    .getByRole('complementary', { name: 'Conversations' })
    .getByRole('button', { name: 'New chat', exact: true })
    .click();
  await expect(input).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Expand message editor' })).toHaveCount(0);
});
