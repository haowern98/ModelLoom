import { defineConfig } from '@playwright/test';

const desktopOnly = process.argv.includes('desktop') || process.argv.includes('--project=desktop');

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: 'list',
  use: { trace: 'retain-on-failure' },
  projects: [
    {
      name: 'browser',
      testMatch: '**/*.browser.spec.ts',
      use: {
        browserName: 'chromium',
        baseURL: 'http://127.0.0.1:5173',
        viewport: { width: 1280, height: 720 },
        deviceScaleFactor: 1,
      },
    },
    { name: 'desktop', testMatch: '**/*.desktop.spec.ts' },
  ],
  ...(desktopOnly
    ? {}
    : {
        webServer: {
          command: 'pnpm dev:web',
          url: 'http://127.0.0.1:5173',
          reuseExistingServer: !process.env.CI,
        },
      }),
});
