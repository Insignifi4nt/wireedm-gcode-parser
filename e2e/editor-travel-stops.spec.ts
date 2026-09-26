import { expect, test } from '@playwright/test';
import { confirmPendingDxfImport } from './dxf-import';

test('explains stop phases and saves an exact travel-distance stop with preview and undo', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Go Build!', exact: true }).click();
  const text = ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC',
    '0', 'SECTION', '2', 'ENTITIES',
    '0', 'LINE', '8', 'CUT', '10', '0', '20', '0', '11', '10', '21', '0',
    '0', 'LINE', '8', 'CUT', '10', '30', '20', '0', '11', '40', '21', '0',
    '0', 'ENDSEC', '0', 'EOF'].join('\n');
  await page.getByLabel('DXF file').setInputFiles({ name: 'travel-distance.dxf', mimeType: 'application/dxf', buffer: Buffer.from(text) });
  await confirmPendingDxfImport(page);
  await page.getByRole('button', { name: 'Machining menu' }).click();
  await page.locator('[data-editor-workflow-command="machining.program-stops"]').click();
  const placement = page.getByLabel('Program stop placement', { exact: true });
  await placement.selectOption('after-exit');
  await expect(page.locator('[data-program-stops-panel]')).toContainText('There is no exit lead');
  await placement.selectOption('after-contour-distance');
  const distance = page.getByLabel('Program stop travel distance millimeters', { exact: true });
  await distance.fill('20');
  await expect(page.getByRole('button', { name: 'Add program stop', exact: true })).toBeDisabled();
  await distance.fill('5');
  await page.getByRole('button', { name: 'Add program stop', exact: true }).click();
  const marker = page.locator('[data-preview-program-stop="stop-1"]');
  await expect(marker).toHaveAttribute('cx', '15');
  await expect(marker).toHaveAttribute('cy', '0');
  await page.screenshot({ path: 'tmp/cam-audit/program-stop-travel-distance.png' });
  await page.getByRole('button', { name: 'Save Program Stops workflow', exact: true }).click();
  await page.getByRole('button', { name: 'Undo active document change', exact: true }).click();
  await expect(marker).toHaveCount(0);
  await page.getByRole('button', { name: 'Redo active document change', exact: true }).click();
  await expect(marker).toHaveAttribute('cx', '15');
  await page.getByRole('button', { name: 'Save active document', exact: true }).click();
  await expect(page.locator('[data-editor-document-state]')).toHaveText('Saved');
  await page.getByRole('button', { name: 'Back to Dashboard', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: /Open project .* in editor/ }).click();
  await expect(marker).toHaveAttribute('cx', '15');
});
