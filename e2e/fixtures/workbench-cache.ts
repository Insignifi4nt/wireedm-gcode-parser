import type { Page } from '@playwright/test';

interface SeedWorkbenchOptions {
  folder?: string;
  namespace?: string;
  project?: string;
}

export async function seedWorkbenchCacheFromFolder(
  page: Page,
  options: SeedWorkbenchOptions = {}
) {
  const { buildWorkbenchCacheSeed } = await import('../../scripts/playwright-workbench-cache.mjs');
  const seed = buildWorkbenchCacheSeed(options);

  await page.goto('/');
  await page.evaluate(
    ({ entries, namespace }) => {
      const prefix = `${namespace}:`;
      const keysToRemove: string[] = [];
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (key?.startsWith(prefix)) keysToRemove.push(key);
      }
      keysToRemove.forEach((key) => localStorage.removeItem(key));
      entries.forEach(([key, value]) => localStorage.setItem(key, value));
    },
    {
      entries: seed.entries,
      namespace: seed.namespace
    }
  );

  return seed;
}

/**
 * Reset only this application's browser-cache namespace before a real upload
 * journey. The caller still reaches the editor through the visible dashboard.
 */
export async function clearWorkbenchCache(page: Page) {
  await page.goto('/');
  await page.evaluate(() => {
    const prefix = 'wire-edm-workbench:';
    const keysToRemove: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(prefix)) keysToRemove.push(key);
    }
    keysToRemove.forEach((key) => localStorage.removeItem(key));
  });
  await page.reload();
}
