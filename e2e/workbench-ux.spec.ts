import { expect, test } from '@playwright/test';
import { confirmPendingDxfImport } from './dxf-import';

test('dashboard menus support keyboard entry and resume the native tab order', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Go Build!', exact: true }).click();
  const importTrigger = page.getByRole('button', { name: 'More path project import options', exact: true });
  const importItem = page.getByRole('menuitem', { name: 'Import UPID Path Project', exact: true });
  await importTrigger.press('ArrowDown');
  await expect(importItem).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(importItem).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open Machine Program', exact: true })).toBeFocused();
  await importTrigger.press('ArrowUp');
  await expect(importItem).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', { name: 'Import DXF as Path Project', exact: true })).toBeFocused();

  await page.getByLabel('DXF file', { exact: true }).setInputFiles('tests/fixtures/machine-packages/robofil-100-v2/no-lead-rectangle.dxf');
  await confirmPendingDxfImport(page);
  await page.getByRole('button', { name: 'Back to Dashboard', exact: true }).click();
  const exportTrigger = page.getByRole('button', { name: /^Export UPID project / });
  await exportTrigger.press('ArrowUp');
  await expect(page.getByRole('menuitem').last()).toBeFocused();
  await page.keyboard.press('Home');
  await expect(page.getByRole('menuitem', { name: 'Export', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(exportTrigger).toBeFocused();
  await exportTrigger.press('Enter');
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', { name: /^Show revisions for project / })).toBeFocused();
  await exportTrigger.press('ArrowDown');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Import DXF as Path Project', exact: true })).toBeFocused();
});

test('blocked controller export opens machine settings and restores the saved editor', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Go Build!', exact: true }).click();
  await page.getByLabel('DXF file', { exact: true }).setInputFiles('tests/fixtures/machine-packages/robofil-100-v2/no-lead-rectangle.dxf');
  await confirmPendingDxfImport(page);
  await page.getByRole('button', { name: 'Export menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Open UPID export preview', exact: true }).click();
  const exportDialog = page.getByRole('dialog', { name: 'Controller artifact export', exact: true });
  await expect(exportDialog).toBeVisible();
  await expect(page.locator('[data-app-header]')).toHaveAttribute('inert', '');
  await exportDialog.getByRole('button', { name: 'Open Machines & setups', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Workbench settings', exact: true });
  await expect(settings.getByRole('heading', { name: 'Machines & setups', exact: true })).toBeVisible();
  await expect(settings.getByRole('button', { name: 'Close settings', exact: true })).toBeFocused();
  await expect(exportDialog).toHaveCount(0);
  await expect(page.locator('[data-app-header]')).toHaveAttribute('inert', '');
  await page.keyboard.press('Escape');
  await expect(settings).toHaveCount(0);
  await expect(page.locator('[data-app-header]')).not.toHaveAttribute('inert', '');
  await expect(page.locator('[data-editor-document-state]')).toHaveText('Saved');
  await expect(page.getByRole('button', { name: 'Export menu', exact: true })).toBeEnabled();
});
