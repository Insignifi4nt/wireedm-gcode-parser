import { expect, type Page } from '@playwright/test';

/** A saved editor URL reopens its project; returning to the library is explicit. */
export async function reloadEditorAndReturnToLibrary(page: Page) {
  await expect(page).toHaveURL(/\/editor\/[^/]+$/);
  const projectUrl = page.url();
  await page.reload();
  await expect(page).toHaveURL(projectUrl);
  await page.getByRole('button', { name: 'Back to Dashboard', exact: true }).click();
}
