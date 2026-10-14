import { _electron as electron, expect, test } from '@playwright/test';
import path from 'node:path';
import { writeFileSync } from 'node:fs';
import { packagedEvidence } from './packaged-runtime-paths';

test.skip(
  process.env.MODELLOOM_PACKAGED_CLIPBOARD_TEST !== '1',
  'Requires the separately built demo and explicit clipboard diagnostic.',
);
test('diagnoses packaged selection copy while retaining the original clipboard formats', async () => {
  const app = await electron.launch({
    executablePath: path.resolve(__dirname, '../out/ModelLoom-win32-x64/ModelLoom.exe'),
  });
  try {
    await app.evaluate(async ({ clipboard, ClipboardItem }) => {
      const items = await clipboard.read();
      const snapshot = await Promise.all(
        items
          .filter((item) => item.types.length)
          .map(
            async (item) =>
              new ClipboardItem(
                Object.fromEntries(
                  await Promise.all(
                    item.types.map(async (type) => [type, await item.getType(type)] as const),
                  ),
                ),
              ),
          ),
      );
      (
        globalThis as typeof globalThis & { modelloomClipboardSnapshot: Electron.ClipboardItem[] }
      ).modelloomClipboardSnapshot = snapshot;
    });
    const window = await app.firstWindow();
    await window.getByRole('button', { name: 'Chat', exact: true }).click();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.focus());
    await expect.poll(() => window.evaluate(() => document.hasFocus())).toBe(true);
    await window.evaluate(() => {
      const events: unknown[] = [];
      (window as typeof window & { copyEvents: unknown[] }).copyEvents = events;
      const write = navigator.clipboard.writeText.bind(navigator.clipboard);
      navigator.clipboard.writeText = async (value) => {
        try {
          await write(value);
          events.push({ method: 'navigator', ok: true });
        } catch (error) {
          events.push({ method: 'navigator', ok: false, error: (error as Error).name });
          throw error;
        }
      };
      const exec = document.execCommand.bind(document);
      document.execCommand = (command, ui, value) => {
        const active = document.activeElement;
        const result = exec(command, ui, value);
        events.push({
          method: command,
          ok: result,
          activeTag: active?.tagName,
          selectedLength:
            active instanceof HTMLTextAreaElement ? active.selectionEnd - active.selectionStart : 0,
        });
        return result;
      };
    });
    const expected = await window
      .getByRole('article', { name: 'Assistant response 2' })
      .locator(':scope > p')
      .innerText();
    await window.getByRole('button', { name: 'Copy response 2', exact: true }).click();
    await expect(window.getByRole('status')).toHaveText('Response copied');
    const result = await app.evaluate(
      async ({ clipboard }, text) => ({
        matched: (await clipboard.readText()).replace(/\r\n/g, '\n') === text,
        types: (await clipboard.read()).flatMap((item) => item.types),
      }),
      expected,
    );
    const events = await window.evaluate(
      () => (window as typeof window & { copyEvents: unknown[] }).copyEvents,
    );
    const main = await app.evaluate(async ({ clipboard }, text) => {
      await clipboard.writeText(text);
      return {
        matched: (await clipboard.readText()).replace(/\r\n/g, '\n') === text,
        types: (await clipboard.read()).flatMap((item) => item.types),
      };
    }, expected);
    writeFileSync(
      path.join(packagedEvidence, 'clipboard-diagnostic.json'),
      JSON.stringify({ result, events, main }),
    );
    expect(result.matched).toBe(true);
  } finally {
    await app.evaluate(async ({ clipboard }) => {
      const state = globalThis as typeof globalThis & {
        modelloomClipboardSnapshot?: Electron.ClipboardItem[];
      };
      if (state.modelloomClipboardSnapshot?.length)
        await clipboard.write(state.modelloomClipboardSnapshot);
      else clipboard.clear();
      delete state.modelloomClipboardSnapshot;
    });
    await app.close();
  }
});
