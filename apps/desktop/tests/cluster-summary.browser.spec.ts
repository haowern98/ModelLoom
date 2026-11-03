import { expect, test } from '@playwright/test';

test('summary matches demo geometry and selects cards with a smooth zoom-preserving transition', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Cluster', exact: true }).click();
  await page.getByRole('button', { name: 'Fit to view', exact: true }).click();
  const zoom = await page.getByLabel('Zoom level').textContent();
  const frames = await page.evaluate(async () => {
    const card = document.querySelector<HTMLElement>('[data-canvas-device]')!;
    const positions = [card.getBoundingClientRect().x];
    document
      .querySelector<HTMLButtonElement>('button[aria-label="Select studio-desktop"]')!
      .click();
    for (let i = 0; i < 24; i++) {
      await new Promise(requestAnimationFrame);
      positions.push(card.getBoundingClientRect().x);
    }
    return positions;
  });
  expect(frames.at(-1)!).toBeLessThan(frames[0]! - 100);
  expect(frames.some((x) => x < frames[0]! - 5 && x > frames.at(-1)! + 5)).toBe(true);
  await expect(page.getByLabel('Zoom level')).toHaveText(zoom!);
  const panel = page.getByRole('complementary', { name: 'Cluster panel' });
  await expect(panel).toBeVisible();
  const geometry = await panel.evaluate((node) => {
    const css = getComputedStyle(node);
    const heading = node.querySelector('h2')!;
    return {
      width: node.getBoundingClientRect().width,
      font: css.fontFamily,
      size: css.fontSize,
      weight: getComputedStyle(heading).fontWeight,
      inset: heading.getBoundingClientRect().left - node.getBoundingClientRect().left,
    };
  });
  expect(geometry).toEqual({
    width: 300,
    font: '"Segoe UI", sans-serif',
    size: '13px',
    weight: '400',
    inset: 20,
  });
  await expect(panel.getByRole('heading', { name: 'Cluster overview' })).toBeVisible();
  await expect(
    panel.getByRole('group', { name: 'Layer assignment for studio-desktop' }),
  ).toHaveAttribute('aria-current', 'true');
  await expect(page.getByRole('article', { name: 'studio-desktop' })).toHaveAttribute(
    'data-selected',
    'true',
  );
  await expect(panel.getByRole('textbox')).toHaveCount(0);

  const disclosure = panel.getByRole('button', { name: 'Speculative workload' });
  await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
  await expect(panel.getByText('Off in model configuration.')).toBeHidden();
  await page.mouse.move(0, 0);
  await disclosure.blur();
  const chevron = disclosure.locator('svg');
  await expect(chevron).toHaveCSS('opacity', '1');
  await disclosure.click();
  await page.mouse.move(0, 0);
  await disclosure.blur();
  await expect(chevron).toHaveCSS('opacity', '0');
  await disclosure.hover();
  await expect(chevron).toHaveCSS('opacity', '1');

  const world = page.locator('[data-canvas-device]').first().locator('..');
  const transform = await world.evaluate((node) => (node as HTMLElement).style.transform);
  await page.getByRole('button', { name: 'Edit layers for studio-desktop GPU 0' }).click();
  await expect(
    page.getByRole('textbox', { name: 'First layer for studio-desktop GPU 0' }),
  ).toBeVisible();
  await expect
    .poll(() => world.evaluate((node) => (node as HTMLElement).style.transform))
    .toBe(transform);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect
    .poll(() => world.evaluate((node) => (node as HTMLElement).style.transform))
    .toBe(transform);
  await page.getByRole('button', { name: 'Cluster panel', exact: true }).click();
  await expect(panel).toBeHidden();
  await expect(page.getByLabel('Zoom level')).toHaveText(zoom!);
});

test('uses real configuration data and SDK placement options inside the persistent summary', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    const modelId = 'a'.repeat(64);
    const uuid = 'GPU-12345678-1234-1234-1234-123456789abc';
    const actions: string[] = [];
    Reflect.set(window, '__summaryActions', actions);
    let loadingStage: number | undefined;
    Reflect.set(window, '__summaryLoading', (stage: number) => {
      loadingStage = stage;
    });
    window.modelLoomRuntime = {
      command: () =>
        Promise.resolve({
          enabled: true,
          model: null,
          models: [{ id: `model-${modelId}`, name: 'Qwen', size: '4 GB', blockCount: 64 }],
          phase: loadingStage === undefined ? 'stopped' : 'loading',
          loadingStage,
          error: null,
          device: {
            name: 'Local',
            os: 'Windows',
            cpuName: 'CPU',
            threads: 8,
            role: 'Coordinator',
            inventory: {
              sampledAt: 1,
              gpus: [
                {
                  id: uuid,
                  name: 'GPU',
                  pciVendorId: '10de',
                  totalMemoryBytes: 8 * 2 ** 30,
                  executionIdentity: { vendor: 'nvidia', uuid, pciBus: '00000000:01:00.0' },
                },
              ],
            },
          },
        }),
    };
    window.modelLoomPeers = {
      command: () =>
        Promise.resolve({
          ok: true,
          view: {
            fingerprint: 'c'.repeat(64),
            name: 'Local',
            sharing: false,
            addresses: ['100.64.1.2'],
            gpus: [],
            sharedGpuIds: [],
            incoming: [],
            outgoing: [
              {
                id: 'approved-worker',
                name: 'ptss',
                peerFingerprint: 'd'.repeat(64),
                phase: 'approved',
                localVerified: true,
                remoteVerified: true,
                gpus: [
                  {
                    id: 'GPU-87654321-4321-4321-4321-cba987654321',
                    name: 'Remote GPU',
                    memoryBytes: 8 * 2 ** 30,
                  },
                ],
              },
            ],
          },
        }),
    };
    window.modelLoomCluster = {
      command: (input) => {
        actions.push(input.action);
        return Promise.resolve({
          ok: true,
          configurations: [],
          configuration: null,
          draft: null,
          load: {
            defaults: {
              automatic: false,
              contextLength: 4096,
              threads: null,
              evaluationBatch: 256,
              physicalBatch: 128,
              concurrency: 1,
              flashAttention: true,
            },
            cacheK: 'f16',
            cacheV: 'f16',
            speculation: {
              version: 1,
              enabled: true,
              proposer: {
                method: 'mtp',
                source: { kind: 'asset', modelId: 'b'.repeat(64) },
                maxDraftTokens: 3,
              },
              retrieval: { method: 'ngram-simple' },
            },
          },
          issues: [],
        });
      },
    };
  });
  await page.goto('http://127.0.0.1:5176');
  await expect(page.getByRole('button', { name: 'Configure Qwen' })).toBeVisible();
  await page.getByRole('button', { name: 'Cluster', exact: true }).click();
  await page.getByRole('button', { name: 'Choose model', exact: true }).click();
  await page.getByRole('menuitem', { name: /Qwen/ }).click();
  await page.getByRole('button', { name: 'Select Local' }).click();
  const panel = page.getByRole('complementary', { name: 'Cluster panel' });
  await expect(panel.getByText('4,096 tokens')).toBeVisible();
  await panel.getByRole('button', { name: 'Speculative workload' }).click();
  await expect(panel.getByText('CPU retrieval')).toBeVisible();
  await expect(panel.getByText('MTP', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, '__summaryActions') as unknown)).toEqual(
    expect.not.arrayContaining(['edit', 'save']),
  );
  await panel.getByRole('button', { name: 'Automatic' }).click();
  const option = page.getByRole('option', { name: 'This PC CPU' });
  await expect(option).toBeVisible();
  await expect(option).toHaveCSS('font-size', '13px');
  await expect(option).toHaveCSS('font-family', '"Segoe UI", sans-serif');
  const popup = option.locator('xpath=ancestor::*[@data-radix-popper-content-wrapper]');
  expect(
    await popup.evaluate((node) =>
      getComputedStyle(node).getPropertyValue('--color-surface-elevated').trim(),
    ),
  ).not.toBe('');
  await page.keyboard.press('Escape');
  await expect(option).toBeHidden();
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: 'Automatic' }).click();
  await option.click();
  await expect(panel.getByRole('button', { name: 'This PC CPU' })).toBeVisible();
  await expect(panel.getByText('Save, then reload to apply.')).toBeVisible();
  const addDevice = page.getByRole('button', { name: 'Add device near Local' });
  await addDevice.focus();
  await expect(addDevice).toHaveAttribute('data-visible', 'true');
  await addDevice.press('Enter');
  await expect(panel.getByRole('region', { name: 'Add device' })).toBeVisible();
  const closePicker = page.getByRole('button', { name: 'Close add device' });
  const addPeer = panel.getByRole('button', { name: 'Add ptss to canvas' });
  await expect(closePicker).toBeFocused();
  expect(await closePicker.evaluate((node) => getComputedStyle(node, '::after').outlineColor)).toBe(
    'rgb(175, 175, 175)',
  );
  for (const button of [closePicker, addPeer]) {
    await expect(button).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(button).toHaveCSS('border-top-width', '0px');
    await expect(button).toHaveCSS('outline-style', 'none');
  }
  await expect(addPeer).toBeEnabled();
  await addPeer.click();
  await expect(page.getByRole('article', { name: 'ptss' })).toBeVisible();
  await expect(panel.getByRole('region', { name: 'Add device' })).toBeHidden();
  await addDevice.focus();
  await addDevice.press('Enter');
  await closePicker.click();
  await expect(panel.getByRole('heading', { name: 'Cluster overview' })).toBeVisible();
  await page.getByRole('button', { name: 'Fit to view', exact: true }).click();
  await page.getByRole('button', { name: 'Connection details between Local and ptss' }).click();
  const connectionToggle = panel.getByRole('button', { name: 'Connection details', exact: true });
  await expect(connectionToggle).toHaveAttribute('aria-expanded', 'false');
  await page.mouse.move(0, 0);
  const connectionChevron = connectionToggle.locator('svg');
  await expect(connectionChevron).toHaveCSS('width', '14px');
  await expect(connectionChevron).toHaveCSS('opacity', '1');
  await connectionToggle.click();
  await page.mouse.move(0, 0);
  await connectionToggle.blur();
  await expect(connectionChevron).toHaveCSS('opacity', '0');
  await connectionToggle.hover();
  await expect(connectionChevron).toHaveCSS('opacity', '1');
  const connectionContent = panel.locator(
    `[id="${await connectionToggle.getAttribute('aria-controls')}"]`,
  );
  await expect(connectionContent.getByText('From', { exact: true })).toBeVisible();
  await expect(connectionContent.getByText('To', { exact: true })).toBeVisible();
  await expect(connectionContent.getByText('ptss', { exact: true })).toBeVisible();
  expect(
    await connectionContent.locator('section, dl, dl > div').evaluateAll((nodes) =>
      nodes.every((node) => {
        const css = getComputedStyle(node);
        return css.borderTopWidth === '0px' && css.borderBottomWidth === '0px';
      }),
    ),
  ).toBe(true);
  await expect(connectionContent.locator('h3')).toHaveCSS('font-size', '13px');
  await expect(connectionContent.locator('h3')).toHaveCSS('font-weight', '400');
  await expect(connectionContent.locator('dt').first()).toHaveCSS('font-size', '13px');
  await expect(connectionContent.locator('p')).toHaveCount(0);
  const latencyInfo = connectionContent.getByRole('button', { name: 'About latency' });
  await expect(latencyInfo.locator('svg')).toHaveCSS('width', '14px');
  await expect(latencyInfo).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await latencyInfo.hover();
  await expect(page.getByRole('tooltip')).toHaveText(
    'Control connection round-trip, including connection setup.',
  );
  const tooltipSurface = page.locator('[data-cluster-sdk][data-theme="dark"][data-side]');
  await expect(tooltipSurface).toHaveCSS('font-family', '"Segoe UI", sans-serif');
  expect(
    await tooltipSurface.evaluate((node) =>
      getComputedStyle(node).getPropertyValue('--color-surface-elevated').trim(),
    ),
  ).not.toBe('');
  expect((await tooltipSurface.boundingBox())!.width).toBeLessThanOrEqual(260);
  await page.mouse.move(0, 0);
  await latencyInfo.focus();
  await expect(page.getByRole('tooltip')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip')).toBeHidden();
  await expect(panel).toBeVisible();
  const bandwidthInfo = connectionContent.getByRole('button', { name: 'About bandwidth' });
  await bandwidthInfo.hover();
  await expect(page.getByRole('tooltip')).toHaveText('Connection measurements are unavailable.');
  await page.mouse.move(0, 0);
  await bandwidthInfo.focus();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip')).toBeHidden();
  await expect(panel).toBeVisible();
  await connectionContent.scrollIntoViewIfNeeded();
  await panel.screenshot({ path: '../../.git/connection-summary-panel.png' });
  await connectionToggle.click();
  await expect(connectionContent).toBeHidden();
  await page.getByRole('button', { name: 'Cluster panel', exact: true }).click();
  await expect(panel).toBeHidden();
  await page.getByRole('button', { name: 'Cluster panel', exact: true }).click();
  await expect(panel).toBeVisible();
  await page.setViewportSize({ width: 900, height: 720 });
  await expect
    .poll(async () => {
      const box = (await panel.boundingBox())!;
      return box.x + box.width;
    })
    .toBeLessThanOrEqual(900);
  const bounds = (await panel.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(900);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(720);
  await page.evaluate(() => {
    (Reflect.get(window, '__summaryLoading') as (stage: number) => void)(1);
  });
  const cancel = page.getByRole('button', { name: 'Cancel loading', exact: true });
  const ring = cancel.locator('circle');
  await expect(ring).toHaveAttribute('stroke-dasharray', '20 100');
  const before = await cancel.boundingBox();
  const iconBefore = await cancel.locator('svg').boundingBox();
  const square = await cancel.locator('svg > path').last().getAttribute('d');
  await page.evaluate(() => {
    (Reflect.get(window, '__summaryLoading') as (stage: number) => void)(4);
  });
  await expect(ring).toHaveAttribute('stroke-dasharray', '80 100');
  expect(await cancel.boundingBox()).toEqual(before);
  expect(await cancel.locator('svg').boundingBox()).toEqual(iconBefore);
  expect(await cancel.locator('svg > path').last().getAttribute('d')).toBe(square);
  await expect(cancel).toHaveAttribute('title', 'Cancel loading · Loading model');
});
