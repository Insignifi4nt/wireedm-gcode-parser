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

test('preserves linked center setup through contour start splitting, undo and saved reopen', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Go Build!', exact: true }).click();
  await page.getByLabel('DXF file').setInputFiles({
    name: 'linked-circle.dxf', mimeType: 'application/dxf',
    buffer: Buffer.from('0\nSECTION\n2\nENTITIES\n0\nCIRCLE\n8\nCUT\n10\n0\n20\n0\n40\n5\n0\nENDSEC\n0\nEOF\n')
  });
  await confirmPendingDxfImport(page);
  await openMachining('machining.initial-wire');
  await page.locator('[data-initial-wire-circle-center]').click();
  await saveWorkflow('machining.initial-wire');
  await openMachining('machining.entry-exit');
  await page.getByLabel('Add center pierce lead-in').click();
  await saveWorkflow('machining.entry-exit');
  await openMachining('machining.set-start');
  await page.getByLabel('Set start point inference').selectOption('nearest');
  await page.getByLabel('Pick explicit contour start').click();
  const target = await page.locator('[data-preview-grid-layer]').evaluate((grid) => {
    const matrix = (grid as SVGGraphicsElement).getScreenCTM();
    if (!matrix) throw new Error('Canvas transform unavailable');
    const point = new DOMPoint(0, 5).matrixTransform(matrix);
    return { x: point.x, y: point.y };
  });
  await page.mouse.move(target.x, target.y);
  await expect(page.locator('[data-upid-start-preview-point]')).toBeVisible();
  await page.mouse.click(target.x, target.y);
  await saveWorkflow('machining.set-start');
  await expectSourceSegments(2);
  await page.getByRole('button', { name: 'Undo active document change', exact: true }).click();
  await expectSourceSegments(1);
  await page.getByRole('button', { name: 'Redo active document change', exact: true }).click();
  await expectSourceSegments(2);
  await page.getByRole('button', { name: 'Save active document', exact: true }).click();
  await expect(page.locator('[data-editor-document-state]')).toHaveText('Saved');
  await page.getByRole('button', { name: 'Back to Dashboard', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: /Open project .* in editor/ }).click();
  await expectSourceSegments(2);
  await openMachining('machining.initial-wire');
  await expect(page.locator('[data-initial-wire-position-preview]')).toHaveText('X0.000 Y0.000');
  await expect(page.locator('[data-initial-wire-circle-center][aria-pressed="true"]')).toHaveCount(1);

  async function openMachining(command: string) {
    await page.getByRole('button', { name: 'Machining menu' }).click();
    await page.locator(`[data-editor-workflow-command="${command}"]`).click();
  }
  async function saveWorkflow(command: string) {
    await page.locator(`[data-editor-workflow-actions="${command}"] button[aria-label^="Save "]`).click();
  }
  async function expectSourceSegments(count: number) {
    await expect.poll(() => page.locator('path[data-preview-segment]').evaluateAll((paths) =>
      new Set(paths.map((path) => path.getAttribute('data-preview-segment'))).size
    )).toBe(count);
  }
});

async function expectReviewedPreview(page: Page) {
  await expect(page.locator('[data-path-marker="start"] circle')).toHaveAttribute('cx', '-17.5');
  await expect(page.locator('[data-preview-travel="rapid-in"]').first()).toHaveAttribute('d', /^M -17\.5 24\.9 L /);
}
