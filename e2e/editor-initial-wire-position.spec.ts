import { expect, test, type Page } from '@playwright/test';

import { confirmPendingDxfImport } from './dxf-import';

test('updates the starting marker and connection after review and preserves them on reopen', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Go Build!', exact: true }).click();
  await page.getByLabel('DXF file').setInputFiles('examples/robofil-100-v2/no-lead-rectangle.dxf');
  await confirmPendingDxfImport(page);
  await page.getByRole('button', { name: 'Machining menu' }).click();
  await page.locator('[data-editor-workflow-command="machining.initial-wire"]').click();

  const originalStartX = await page.locator('[data-path-marker="start"] circle').getAttribute('cx');
  if (originalStartX === null) throw new Error('Expected an initial START marker');
  await page.getByLabel('Initial wire X', { exact: true }).fill('-17.5');
  await page.getByLabel('Initial wire Y', { exact: true }).fill('24.9');
  await expect(page.locator('[data-path-marker="start"] circle')).toHaveAttribute('cx', originalStartX);
  await expect(page.locator('[data-initial-wire-position-pending]')).toContainText('Coordinates are pending');
  await page.getByRole('button', { name: 'Review and set manual initial wire position', exact: true }).click();
  await expect(page.locator('[data-initial-wire-position-preview]')).toHaveText('X-17.500 Y24.900');
  await expect(page.locator('[data-initial-wire-position-pending]')).toHaveCount(0);
  await expectReviewedPreview(page);
  await page.getByRole('button', { name: 'Save Initial wire position workflow', exact: true }).click();
  await expectReviewedPreview(page);
  await page.getByRole('button', { name: 'Save active document', exact: true }).click();
  await expect(page.locator('[data-editor-document-state]')).toHaveText('Saved');
  await page.getByRole('button', { name: 'Back to Dashboard', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: /Open project .* in editor/ }).click();
  await expectReviewedPreview(page);
});

async function expectReviewedPreview(page: Page) {
  await expect(page.locator('[data-path-marker="start"] circle')).toHaveAttribute('cx', '-17.5');
  await expect(page.locator('[data-preview-travel="rapid-in"]').first()).toHaveAttribute('d', /^M -17\.5 24\.9 L /);
}
