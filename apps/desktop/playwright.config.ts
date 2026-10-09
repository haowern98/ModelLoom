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
        baseURL: 'http://127.0.0.1:5175',
        viewport: { width: 1280, height: 720 },
        deviceScaleFactor: 1,
      },
    },
    { name: 'desktop', testMatch: '**/*.desktop.spec.ts' },
  ],
  ...(desktopOnly
    ? {}
    : {
        webServer: [
          {
            command:
              'pnpm exec vite --config vite.renderer.config.ts --host 127.0.0.1 --port 5175 --strictPort --mode demo',
            url: 'http://127.0.0.1:5175',
            reuseExistingServer: !process.env.CI,
          },
          {
            command:
              'pnpm exec vite --config vite.renderer.config.ts --host 127.0.0.1 --port 5176 --strictPort',
            url: 'http://127.0.0.1:5176',
            reuseExistingServer: !process.env.CI,
          },
        ],
      }),
});
