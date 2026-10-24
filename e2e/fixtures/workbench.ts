import { expect, type Page } from '@playwright/test';

/** Open the dashboard once both import inputs are ready. */
export async function openReadyWorkbench(page: Page) {
  await page.goto('/');
  await expect(page.locator('input[aria-label="DXF file"]')).toBeEnabled();
  await expect(page.locator('input[aria-label="Machine program file"]')).toBeEnabled();
}
