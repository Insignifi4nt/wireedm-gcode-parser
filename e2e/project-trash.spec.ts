import { expect, test } from '@playwright/test';
import { confirmPendingDxfImport } from './dxf-import';

test('restores a deleted DXF project after reload and reopens its geometry', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Go Build!', exact: true }).click();
  await page.getByLabel('DXF file').setInputFiles('tests/fixtures/machine-packages/robofil-100-v2/no-lead-rectangle.dxf');
  await confirmPendingDxfImport(page);
  await expect(page.getByRole('button', { name: 'Save active document', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back to Dashboard' }).click();
  await page.getByRole('button', { name: /^Delete project / }).click();
  await page.getByRole('dialog', { name: 'Delete project', exact: true }).getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Open project / })).toHaveCount(0);
  await page.reload();
  await page.getByText('Deleted projects (1)', { exact: true }).click();
  await page.screenshot({ path: 'tmp/cam-audit/12-project-trash-reload.png', fullPage: true });
  await page.getByRole('button', { name: 'Restore no-lead-rectangle', exact: true }).click();
  await expect(page.getByText('Deleted projects (1)', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Open project / })).toBeFocused();
  await page.getByRole('button', { name: /^Open project / }).click();
  await expect(page.getByRole('button', { name: 'Save active document', exact: true })).toBeVisible();
  await page.screenshot({ path: 'tmp/cam-audit/13-project-restored-editor.png', fullPage: true });
});
