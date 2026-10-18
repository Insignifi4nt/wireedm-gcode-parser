import { expect, type Page } from '@playwright/test';

/** Close the first-run dialog when it appears; reloads of a dismissed workbench skip it. */
export async function dismissOnboarding(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'Thanks for trying Wire EDM Workbench' });
  await dialog.waitFor({ state: 'visible', timeout: 2_000 }).catch(() => undefined);
  if (await dialog.isVisible()) await dialog.getByRole('button', { name: 'Go Build!' }).click();
}

/** Open the dashboard once both import inputs are ready. */
export async function openReadyWorkbench(page: Page) {
  await page.goto('/');
  await expect(page.locator('input[aria-label="DXF file"]')).toBeEnabled();
  await expect(page.locator('input[aria-label="Machine program file"]')).toBeEnabled();
  await dismissOnboarding(page);
}
