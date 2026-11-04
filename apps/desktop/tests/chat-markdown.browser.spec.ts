import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const fence = String.fromCharCode(96).repeat(3);
const markdown = [
  '## A rendered answer',
  '',
  'This answer has **bold text**, *emphasis*, and ' +
    String.fromCharCode(96) +
    'inline code' +
    String.fromCharCode(96) +
    '.',
  '',
  '### What changes',
  '',
  '- Headings and lists render normally',
  '  - Nested items stay indented',
  '- Your response controls stay in place',
  '',
  '> A quotation stays separate from the answer.',
  '',
  fence + 'javascript',
  'const message = "Markdown is ready";',
  'console.log(message); // ' + 'a long line '.repeat(18),
  fence,
  '',
  '| Name | Model | Status | Memory | Context | Backend | Precision | Mode |',
  '| --- | --- | --- | --- | --- | --- | --- | --- |',
  '| Example | Local | Ready | 8 GiB | 8192 | CPU | Q4_K_M | Chat |',
  '',
  '[Example link](https://example.com/docs)',
].join('\n');

async function fixture(page: Page, text: string) {
  await page.addInitScript(
    ({ text }) => {
      window.modelLoomRuntime = {
        command: () =>
          Promise.resolve({ enabled: true, model: null, phase: 'stopped', error: null }),
      };
      window.modelLoomChat = {
        subscribe: (callback) => {
          window.addEventListener('fixture-chat-update', callback);
          return () => window.removeEventListener('fixture-chat-update', callback);
        },
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
                        title: 'Markdown rendering preview',
                        revision: 1,
                        updated: Date.now(),
                      },
                    ]
                  : {
                      id: 'fixture',
                      title: 'Markdown rendering preview',
                      draft: '',
                      revision: 1,
                      turns: [
                        {
                          id: 'turn',
                          text: 'Show a formatted answer with code and a table.',
                          attempts: [
                            {
                              id: 'attempt',
                              requestId: 'request',
                              state: document.documentElement.dataset.fixtureState ?? 'completed',
                              text: document.documentElement.dataset.fixtureMarkdown ?? text,
                              reasoning: '**Check** the formatting before answering.',
                              thinkingMs: 12000,
                              speeds: { generation: 16.1, prefill: 400, acceptance: 0.367 },
                            },
                          ],
                        },
                      ],
                    },
              ),
            },
          }),
      };
    },
    { text },
  );
  await page.goto('/');
  await page
    .getByRole('complementary', { name: 'Main navigation' })
    .getByRole('button', { name: 'Chat', exact: true })
    .click();
}

for (const width of [1280, 1000]) {
  test('Markdown layout and unchanged footer at ' + width + 'px', async ({ page }) => {
    await page.setViewportSize({ width, height: 1100 });
    const remoteRequests: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('tracker.invalid')) remoteRequests.push(request.url());
    });
    await fixture(page, markdown + '\n\n![Remote](https://tracker.invalid/pixel)');
    const response = page.getByRole('article', { name: 'Assistant response 2' });
    await expect(response.getByRole('heading', { name: 'A rendered answer' })).toBeVisible();
    await expect(response.locator('strong').filter({ hasText: 'bold text' })).toBeVisible();
    await expect(response.getByRole('table')).toBeVisible();
    await expect(response.locator('.hljs-keyword')).toContainText(['const']);
    await expect(response.getByRole('button', { name: 'Copy code' })).toBeVisible();
    await expect(response.getByText('Complete', { exact: true })).toHaveCount(0);
    await expect(response.getByRole('button', { name: 'Copy response 2' })).toBeVisible();
    await expect(response.getByRole('button', { name: 'Retry response 2' })).toBeVisible();
    const metrics = response.getByText('Generation: 16.1 tok/s');
    await expect(metrics).toHaveCSS('font-size', '12px');
    await expect(metrics).toHaveCSS('color', 'rgb(171, 171, 171)');
    await expect(response.getByText('Prompt processing: 400 tok/s')).toBeVisible();
    await expect(response.getByText('Acceptance rate: 36.7%')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    for (const scroll of [
      response.locator('pre'),
      response.getByRole('region', { name: 'Scrollable table' }),
    ]) {
      expect(await scroll.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
      await scroll.evaluate((node) => {
        node.scrollLeft = 100;
      });
      expect(await scroll.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
    }
    for (const scroll of [
      response.locator('pre'),
      response.getByRole('region', { name: 'Scrollable table' }),
    ]) {
      await scroll.evaluate((node) => {
        node.scrollLeft = 0;
      });
    }
    expect(remoteRequests).toEqual([]);
    await page.getByRole('region', { name: 'Messages' }).evaluate((node) => {
      node.scrollTop = 0;
    });
    await page.screenshot({ path: test.info().outputPath('markdown-' + width + '.png') });
    await response.getByText('Thought for 12s').click();
    await expect(response.locator('details strong')).toHaveText('Check');
    await expect(response.locator('summary svg')).toHaveCount(1);
  });
}

test('streams open code fences, keeps code as text and preserves Stopped', async ({ page }) => {
  await fixture(page, fence + 'unknown-language\n<script>alert(1)</script>');
  const response = page.getByRole('article', { name: 'Assistant response 2' });
  await expect(response.locator('pre code')).toHaveText('<script>alert(1)</script>\n');
  expect(await response.locator('script').count()).toBe(0);
  const update = async (value: { text: string; state: string }) => {
    await page.evaluate((value) => {
      document.documentElement.dataset.fixtureMarkdown = value.text;
      document.documentElement.dataset.fixtureState = value.state;
      window.dispatchEvent(new Event('fixture-chat-update'));
    }, value);
  };
  await update({ text: fence + 'python\nprint("hel', state: 'running' });
  await expect(response.locator('pre code')).toContainText('print("hel');
  await expect(response.getByText('Generating…')).toBeVisible();
  await update({
    text: fence + 'python\nprint("hello")\n' + fence + '\n\n**Finished**',
    state: 'cancelled',
  });
  await expect(response.getByText('Finished')).toHaveJSProperty('tagName', 'STRONG');
  await expect(response.getByText('Stopped', { exact: true })).toBeVisible();
  await expect(response.locator('pre')).toHaveCount(1);
});
