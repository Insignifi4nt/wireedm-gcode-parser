import { defineConfig, devices } from '@playwright/test';

// CI has just verified this production build. Local runs keep their own snapshot
// so development cannot replace the files under an active browser test.
const useExistingBuild = process.env.PLAYWRIGHT_USE_EXISTING_BUILD === 'true';
const previewCommand = 'npx vite preview --host 127.0.0.1 --port 3107 --strictPort';

export default defineConfig({
  tsconfig: './tsconfig.app.json',
  testDir: './e2e',
  fullyParallel: true,
  reporter: [['list'], ['html', { open: 'never' }]],
  retries: process.env.CI ? 2 : 0,
  // CI renders CAD through software SwiftShader; long sketch journeys take 15–35 s there.
  timeout: process.env.CI ? 60_000 : 30_000,
  use: {
    baseURL: 'http://127.0.0.1:3107',
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
    video: 'retain-on-failure'
  },
  webServer: {
    // Keep each run on one built version while development continues in parallel.
    command: useExistingBuild ? `${previewCommand} --outDir dist`
      : `npx vite build --outDir tmp/playwright-dist && ${previewCommand} --outDir tmp/playwright-dist`,
    reuseExistingServer: false,
    url: 'http://127.0.0.1:3107'
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Pin the isolated test browser's renderer: the default Windows headless
        // ANGLE path can lose its context during otherwise valid CAD rendering.
        launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }
      }
    }
  ]
});
