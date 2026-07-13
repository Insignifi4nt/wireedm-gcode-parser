import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: [['list'], ['html', { open: 'never' }]],
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: 'http://127.0.0.1:3107',
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
    video: 'retain-on-failure'
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 3107 --strictPort',
    reuseExistingServer: false,
    url: 'http://127.0.0.1:3107'
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ]
});
