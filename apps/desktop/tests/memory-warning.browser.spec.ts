import { expect, test } from '@playwright/test';
import type { RuntimeCommand } from '../src/shared/runtime';

for (const viewport of [
  { width: 1280, height: 720 },
  { width: 700, height: 650 },
]) {
  for (const choice of ['Cancel', 'Load anyway', 'Close dialog', 'Escape'] as const) {
    test(`memory warning ${choice} at ${viewport.width} × ${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.addInitScript(() => {
        let warning: { id: string } | null = { id: '12345678-1234-1234-1234-123456789abc' };
        const decisions: RuntimeCommand[] = [];
        Object.assign(window, { memoryDecisions: decisions });
        window.modelLoomRuntime = {
          command: (input) => {
            if (input.action === 'memory-decision') {
              decisions.push(input);
              warning = null;
            }
            return Promise.resolve({
              enabled: true,
              phase: 'loading',
              error: null,
              model: { id: 'model-observed', name: 'Bonsai 27B', size: '3.80 GB' },
              memoryWarning: warning,
            });
          },
        };
      });
      await page.goto('http://127.0.0.1:5176');
      const dialog = page.getByRole('dialog', { name: 'Not enough available memory' });
      await expect(dialog).toBeVisible();
      if (viewport.width === 1280 && choice === 'Cancel')
        await page.screenshot({ path: 'E:/ModelLoom-Project/plans/memory-warning-preview.png' });
      await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
      await expect(dialog).toContainText(
        'This configuration is estimated to need more memory than is currently available. Loading may fail or run slowly. Your model and settings will stay the same.',
      );
      const bounds = await dialog.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.y).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
      for (const name of ['Cancel', 'Load anyway']) {
        const button = await dialog.getByRole('button', { name, exact: true }).boundingBox();
        expect(button).not.toBeNull();
        expect(button!.x).toBeGreaterThanOrEqual(bounds!.x);
        expect(button!.y).toBeGreaterThanOrEqual(bounds!.y);
        expect(button!.x + button!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width);
        expect(button!.y + button!.height).toBeLessThanOrEqual(bounds!.y + bounds!.height);
      }
      if (choice === 'Escape') await page.keyboard.press('Escape');
      else await dialog.getByRole('button', { name: choice, exact: true }).click();
      await expect(dialog).toHaveCount(0);
      const decisions = await page.evaluate(
        () => Reflect.get(window, 'memoryDecisions') as RuntimeCommand[],
      );
      expect(decisions).toEqual([
        {
          action: 'memory-decision',
          id: '12345678-1234-1234-1234-123456789abc',
          loadAnyway: choice === 'Load anyway',
        },
      ]);
    });
  }
}
