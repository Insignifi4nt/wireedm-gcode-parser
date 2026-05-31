import { expect, test } from '@playwright/test';

test('loads the workbench dashboard in a real browser', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveTitle(/Wire EDM Workbench/);
  await expect(page.locator('[data-app-shell]')).toBeVisible();
  await expect(page.getByRole('button', { name: /import dxf/i })).toBeVisible();
  await expect(page.getByText(/Latest DXF Import/i)).toBeVisible();
});
