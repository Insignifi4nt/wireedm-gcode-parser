import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';

/** Independent engine coverage for persistence, migration and public export APIs. */
export default defineConfig({
  ...base,
  testMatch: ['indexeddb-workbench.spec.ts', 'storage-capabilities.spec.ts', 'hosted-recovery.spec.ts', 'legacy-workbench-startup.spec.ts'],
  outputDir: 'test-results/storage-firefox',
  projects: [{ name: 'firefox-storage', use: { ...devices['Desktop Firefox'] } }]
});
