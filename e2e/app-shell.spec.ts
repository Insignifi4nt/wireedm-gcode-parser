import { expect, test } from '@playwright/test';

test('loads the workbench dashboard in a real browser', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveTitle(/Wire EDM Workbench/);
  await expect(page.locator('[data-app-shell]')).toBeVisible();
  await expect(page.locator('[data-workbench-page]')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Workbench' })).toBeVisible();
  await expect(page.locator('[data-project-library]')).toBeVisible();
  await expect(
    page.getByRole('button', { name: /Import DXF as Path Project/i })
  ).toBeVisible();
  await expect(page.getByRole('button', { name: /Open Machine Program/i })).toBeVisible();
  await expect(page.locator('[data-app-status-bar]')).toBeVisible();
  await expect(page.getByText('flange-slot')).toHaveCount(0);
  await expect(page.getByText('repair-job')).toHaveCount(0);
  await expect(page.getByText(/Latest DXF Import/i)).toHaveCount(0);
});
