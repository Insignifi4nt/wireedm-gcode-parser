import { expect, test } from '@playwright/test';
import { confirmPendingDxfImport } from './dxf-import';

test('edits stops from their panel without losing pending fields and undoes the workflow', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Go Build!', exact: true }).click();
  await page.getByLabel('DXF file').setInputFiles('examples/robofil-100-v2/no-lead-rectangle.dxf');
  await confirmPendingDxfImport(page);
  await page.getByRole('button', { name: 'Machining menu' }).click();
  await page.locator('[data-editor-workflow-command="machining.program-stops"]').click();
  await page.getByLabel('Program stop remaining cut millimeters', { exact: true }).fill('2');
  await page.getByRole('button', { name: 'Add program stop', exact: true }).click();
  const marker = page.locator('[data-preview-program-stop="stop-1"]');
  await expect(marker).toBeVisible();
  const before = await marker.evaluate((node) => [node.getAttribute('cx'), node.getAttribute('cy')]);
  await page.getByLabel('Program stop placement', { exact: true }).selectOption('after-exit');
  await page.getByRole('button', { name: 'Add program stop', exact: true }).click();

  await page.getByRole('button', { name: 'Edit stop-1', exact: true }).click();
  const remaining = page.getByLabel('Selected stop remaining cut millimeters', { exact: true });
  await expect(remaining).toHaveValue('2');
  await remaining.fill('3');
  await expect(page.getByRole('button', { name: 'Edit stop-2', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Apply stop-1', exact: true }).click();
  expect(await marker.evaluate((node) => [node.getAttribute('cx'), node.getAttribute('cy')])).not.toEqual(before);
  const markerWidth = (await marker.boundingBox())!.width;
  await page.getByRole('button', { name: 'Zoom preview out', exact: true }).click();
  expect((await marker.boundingBox())!.width).toBeCloseTo(markerWidth, 1);
  await page.getByRole('button', { name: 'Edit stop-2', exact: true }).click();
  await expect(page.getByLabel('Selected stop placement', { exact: true })).toHaveValue('after-exit');
  await expect(page.locator('[data-program-stop="stop-1"]')).toContainText('3.000 mm remaining');
  await page.getByRole('button', { name: 'Save Program Stops workflow', exact: true }).click();
  await page.getByRole('button', { name: 'Undo active document change', exact: true }).click();
  await page.getByRole('button', { name: 'Machining menu' }).click();
  await page.locator('[data-editor-workflow-command="machining.program-stops"]').click();
  await expect(page.locator('[data-program-stop]')).toHaveCount(0);
  await expect(page.locator('[data-preview-program-stop]')).toHaveCount(0);
});
