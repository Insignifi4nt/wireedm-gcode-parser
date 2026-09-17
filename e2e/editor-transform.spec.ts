import { expect, test } from '@playwright/test';
import { confirmPendingDxfImport } from './dxf-import';

test('transforms preview, cancel, commit once and persist through reopening', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Go Build!', exact: true }).click();
  await page.getByLabel('DXF file').setInputFiles('tests/fixtures/machine-packages/robofil-100-v2/no-lead-rectangle.dxf');
  await confirmPendingDxfImport(page);
  const geometry = () => page.locator('path[data-preview-source="path-document"][data-type="cut"]').evaluateAll(paths => paths.map(path => path.getAttribute('d')));
  const original = await geometry();
  const openTransform = async () => {
    await page.getByRole('button', { name: 'Geometry menu', exact: true }).click();
    await page.locator('[data-editor-workflow-command="geometry.transform"]').click();
  };
  const apply = async () => {
    await page.getByRole('button', { name: 'Rotate document 90 degrees counterclockwise', exact: true }).click();
    await page.getByRole('button', { name: 'Mirror document across X axis', exact: true }).click();
    await page.getByLabel('Translate X', { exact: true }).fill('');
    await page.getByLabel('Translate Y', { exact: true }).fill('3');
    await expect(page.getByRole('button', { name: 'Apply translation to document geometry', exact: true })).toBeDisabled();
    await expect(page.getByText('Enter both move coordinates. Use 0 for an unchanged axis.')).toBeVisible();
    await page.getByLabel('Translate X', { exact: true }).fill('2');
    await page.getByRole('button', { name: 'Apply translation to document geometry', exact: true }).click();
  };
  await openTransform();
  await apply();
  expect(await geometry()).not.toEqual(original);
  await page.locator('[data-editor-workflow-actions="geometry.transform"] button[aria-label^="Cancel "]').click();
  await page.locator('[data-editor-workflow-transition-action="discard"]').click();
  expect(await geometry()).toEqual(original);
  await expect(page.getByRole('button', { name: 'Undo active document change', exact: true })).toBeDisabled();
  await openTransform();
  await apply();
  const transformed = await geometry();
  await page.locator('[data-editor-workflow-actions="geometry.transform"] button[aria-label^="Save "]').click();
  await page.getByRole('button', { name: 'Undo active document change', exact: true }).click();
  expect(await geometry()).toEqual(original);
  await expect(page.getByRole('button', { name: 'Undo active document change', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Redo active document change', exact: true }).click();
  expect(await geometry()).toEqual(transformed);
  await page.getByRole('button', { name: 'Save active document', exact: true }).click();
  await expect(page.locator('[data-editor-document-state]')).toHaveText('Saved');
  await page.getByRole('button', { name: 'Back to Dashboard', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: /Open project .* in editor/ }).click();
  expect(await geometry()).toEqual(transformed);
  await expect(page.locator('[data-editor-document-state]')).toHaveText('Saved');
});
