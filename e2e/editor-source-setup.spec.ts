import { expect, test } from '@playwright/test';

import { confirmPendingDxfImport } from './dxf-import';

test('opens source setup and reviews a unit rebuild from the saved DXF', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Go Build!', exact: true }).click();
  await page.getByLabel('DXF file').setInputFiles('tests/fixtures/machine-packages/robofil-100-v2/no-lead-rectangle.dxf');
  await confirmPendingDxfImport(page);
  const geometry = () => page.locator('path[data-preview-source="path-document"][data-type="cut"]')
    .evaluateAll(paths => paths.map(path => path.getAttribute('d')));
  const original = await geometry();
  const openSetup = async () => {
    await page.getByRole('button', { name: 'Geometry menu', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Source & Machine Setup', exact: true }).click();
  };
  await openSetup();
  const setup = page.locator('[data-editor-machine-section]');
  await expect(setup).toBeVisible();
  await expect(setup.locator('[data-editor-machine="definition"]')).toHaveText('Not selected');
  await expect(setup).toContainText('Choose a default planning machine in Workbench Settings');
  await expect(setup).toContainText('10.000 × 10.000 mm');
  const reimport = page.getByRole('button', { name: 'Re-import with different units', exact: true });
  await reimport.click();
  const review = page.getByRole('dialog', { name: 'Review DXF unit re-import', exact: true });
  await review.getByLabel('DXF units', { exact: true }).selectOption('inches');
  const rebuild = review.getByRole('button', { name: 'Re-import and open', exact: true });
  await expect(rebuild).toBeDisabled();
  await review.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await geometry()).toEqual(original);
  await openSetup();
  await reimport.click();
  await review.getByLabel('DXF units', { exact: true }).selectOption('inches');
  const override = review.getByLabel('Override declared DXF units', { exact: true });
  if (await override.isVisible()) await override.check();
  await review.getByLabel('Rebuild path geometry from raw DXF', { exact: true }).check();
  await rebuild.click();
  await expect(review).toHaveCount(0);
  await expect(page.locator('[data-editor-document-state]')).toHaveText('Saved');
  const rebuilt = await geometry();
  expect(rebuilt).not.toEqual(original);
  await openSetup();
  await expect(setup.locator('[data-editor-dxf-unit-basis]')).toHaveText(/override|confirmed/i);
  await expect(setup).toContainText('25.4');
  await expect(setup).toContainText('254.000 × 254.000 mm');
  await page.screenshot({ path: 'tmp/cam-audit/20-source-machine-setup.png' });
  await page.getByRole('button', { name: 'Back to Dashboard', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: /Open project .* in editor/ }).click();
  expect(await geometry()).toEqual(rebuilt);
});
