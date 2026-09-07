import { expect, test } from '@playwright/test';
import { confirmPendingDxfImport } from './dxf-import';

test('keeps threading defaults and overrides distinct through save and reopen', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Go Build!', exact: true }).click();
  await page.getByLabel('DXF file').setInputFiles({
    name: 'two-cuts.dxf', mimeType: 'application/dxf',
    buffer: Buffer.from('0\nSECTION\n2\nENTITIES\n0\nCIRCLE\n8\nCUT\n10\n0\n20\n0\n40\n5\n0\nCIRCLE\n8\nCUT\n10\n20\n20\n0\n40\n5\n0\nENDSEC\n0\nEOF\n')
  });
  await confirmPendingDxfImport(page);
  await page.getByRole('button', { name: 'Machining menu' }).click();
  await page.locator('[data-editor-workflow-command="machining.between-contours"]').click();
  const destination = page.getByLabel('Between contours destination operation', { exact: true });
  await destination.selectOption({ index: 1 });
  const defaultMode = page.getByLabel('Project threading default', { exact: true });
  await expect(defaultMode).toHaveValue('');
  await defaultMode.selectOption('manual');
  await page.getByLabel('Project manual wire separation', { exact: true }).selectOption('manual-before-positioning');
  const override = page.getByLabel('Operation threading mode', { exact: true });
  await override.selectOption('automatic');
  await defaultMode.selectOption('continuous');
  await expect(override).toHaveValue('automatic');
  await page.screenshot({ path: 'tmp/cam-audit/10-between-contours.png', fullPage: true });
  await page.locator('[data-editor-workflow-actions="machining.between-contours"] button[aria-label^="Save "]').click();
  await page.getByRole('button', { name: 'Save active document', exact: true }).click();
  await page.getByRole('button', { name: 'Back to Dashboard' }).click();
  await page.reload();
  await page.getByRole('button', { name: /Open project .* in editor/ }).click();
  await page.getByRole('button', { name: 'Machining menu' }).click();
  await page.locator('[data-editor-workflow-command="machining.between-contours"]').click();
  await destination.selectOption({ index: 1 });
  await expect(defaultMode).toHaveValue('continuous');
  await expect(override).toHaveValue('automatic');
  await override.selectOption('project-default');
  await expect(page.locator('[data-between-contours-panel]')).toContainText('Keep the wire threaded while positioning');
  await page.locator('[data-editor-workflow-actions="machining.between-contours"] button[aria-label^="Save "]').click();
  await page.getByRole('button', { name: 'Undo active document change', exact: true }).click();
  await page.getByRole('button', { name: 'Machining menu' }).click();
  await page.locator('[data-editor-workflow-command="machining.between-contours"]').click();
  await destination.selectOption({ index: 1 });
  await expect(override).toHaveValue('automatic');
});
