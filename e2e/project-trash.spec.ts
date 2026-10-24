import { expect, test } from '@playwright/test';
import { confirmPendingDxfImport } from './dxf-import';

test('restores a deleted DXF project after reload and reopens its geometry', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByLabel('DXF file', { exact: true })).toBeEnabled();
  await page.getByLabel('DXF file').setInputFiles('tests/fixtures/machine-packages/robofil-100-v2/no-lead-rectangle.dxf');
  await confirmPendingDxfImport(page);
  await expect(page.getByRole('button', { name: 'Save active document', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back to Dashboard' }).click();
  const projectName = `Archived-${'long-part-name-'.repeat(9)}`;
  await page.getByRole('button', { name: /^Rename project / }).click();
  await page.getByRole('textbox', { name: 'Project name', exact: true }).fill(projectName);
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: /^Delete project / }).click();
  await page.getByRole('dialog', { name: 'Delete project', exact: true }).getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Open project / })).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: 'Filter projects', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Archived', exact: true }).click();
  await page.keyboard.press('Escape');
  for (const width of [1705, 1280, 700, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await expect(page.getByRole('button', { name: `Restore ${projectName}`, exact: true })).toBeVisible();
  }
  await page.setViewportSize({ width: 1705, height: 1000 });
  await page.screenshot({ path: 'tmp/cam-audit/12-project-trash-reload.png', fullPage: true });
  await page.getByRole('button', { name: `Restore ${projectName}`, exact: true }).click();
  await expect(page.getByRole('button', { name: /^Open project / })).toBeFocused();
  await page.getByRole('button', { name: 'Filter projects', exact: true }).click();
  await expect(page.getByRole('menuitemradio', { name: 'Active projects', exact: true })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^Open project / }).click();
  await expect(page.getByRole('button', { name: 'Save active document', exact: true })).toBeVisible();
  await page.screenshot({ path: 'tmp/cam-audit/13-project-restored-editor.png', fullPage: true });
});
