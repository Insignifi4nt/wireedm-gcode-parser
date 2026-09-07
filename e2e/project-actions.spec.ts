import { expect, test } from '@playwright/test';

test('keeps project action focus contained and returns it after rename or cancellation', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Go Build!', exact: true }).click();
  await page.getByLabel('Machine program file', { exact: true }).setInputFiles({
    name: 'plate.nc', mimeType: 'text/plain', buffer: Buffer.from('G21\nG0 X0 Y0\nG1 X10 Y0')
  });
  await page.getByRole('button', { name: 'Back to Dashboard', exact: true }).click();
  const rename = page.getByRole('button', { name: /^Rename project / });
  await rename.click();
  const dialog = page.getByRole('dialog', { name: 'Rename project', exact: true });
  await expect(dialog.getByLabel('Project name', { exact: true })).toBeFocused();
  await expect(page.locator('[data-app-header]')).toHaveAttribute('inert', '');
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Close rename dialog' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Rename', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Close rename dialog' })).toBeFocused();
  await dialog.getByLabel('Project name', { exact: true }).fill('Reviewed plate');
  await dialog.getByRole('button', { name: 'Rename', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(rename).toBeFocused();
  await expect(page.getByText('Reviewed plate', { exact: true })).toBeVisible();
  await page.getByLabel('Search projects', { exact: true }).fill('missing project');
  await expect(page.locator('[data-project-row]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await expect(page.getByText('Reviewed plate', { exact: true })).toBeVisible();
  const remove = page.getByRole('button', { name: /^Delete project / });
  await remove.click();
  await expect(page.getByRole('dialog', { name: 'Delete project', exact: true }).getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(remove).toBeFocused();
  await expect(page.getByText('Reviewed plate', { exact: true })).toBeVisible();
  await expect(page.locator('[data-app-header]')).not.toHaveAttribute('inert', '');
});
