import { expect, test } from '@playwright/test';

const ordinaryPreview = 'http://127.0.0.1:5176';
const sampleModels = [
  'Qwen3.8-27B',
  'Llama 3.1 8B',
  'Mistral 7B Instruct',
  'Phi 3 Mini',
  'Gemma 2 9B',
];
const sampleDevices = ['studio-desktop', 'ml-workstation', 'mac-studio', 'inference-node'];

test('ordinary startup has empty Models and Cluster when no runtime bridge exists', async ({
  page,
}) => {
  await page.goto(ordinaryPreview);
  await expect(page.getByText('Demo data', { exact: true })).toHaveCount(0);
  for (const name of sampleModels)
    await expect(page.getByText(name, { exact: true })).toHaveCount(0);
  await expect(page.getByText('No runtime connected', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cluster', exact: true }).click();
  for (const name of sampleDevices)
    await expect(page.getByText(name, { exact: true })).toHaveCount(0);
  await expect(page.getByText('No devices connected', { exact: true })).toBeVisible();
});

test('a disabled live core shows the detected local device without filling Models with samples', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.modelLoomRuntime = {
      command: () =>
        Promise.resolve({
          enabled: false,
          phase: 'stopped',
          error: null,
          model: null,
          device: {
            name: 'actual-desktop',
            os: 'Windows',
            cpuName: 'Detected CPU',
            threads: 8,
            role: 'Coordinator',
          },
        }),
    };
  });
  await page.goto(ordinaryPreview);
  await expect(page.getByText('Demo data', { exact: true })).toHaveCount(0);
  for (const name of sampleModels)
    await expect(page.getByText(name, { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Cluster', exact: true }).click();
  await expect(page.getByRole('article', { name: 'actual-desktop', exact: true })).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(1);
  for (const name of sampleDevices)
    await expect(page.getByText(name, { exact: true })).toHaveCount(0);
});
