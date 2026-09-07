import { expect, test, type Page } from '@playwright/test';
import { confirmPendingDxfImport } from './dxf-import';

test.use({ hasTouch: true });

async function openRectangle(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Go Build!', exact: true }).click();
  await page.getByLabel('DXF file').setInputFiles('examples/robofil-100-v2/no-lead-rectangle.dxf');
  await confirmPendingDxfImport(page);
}

async function canvasPoint(page: Page, x: number, y: number) {
  return page.locator('[data-preview-grid-layer]').evaluate((grid, point) => {
    const matrix = (grid as SVGGraphicsElement).getScreenCTM();
    if (!matrix) throw new Error('Canvas transform unavailable');
    const screen = new DOMPoint(point.x, point.y).matrixTransform(matrix);
    return { x: screen.x, y: screen.y };
  }, { x, y });
}

test('measures exact snapped points repeatedly without modifying the document', async ({ page }) => {
  await openRectangle(page);
  const geometry = await page.locator('path[data-preview-segment]').evaluateAll((paths) => paths.map((path) => path.getAttribute('d')));
  await page.getByRole('button', { name: 'Construction menu' }).click();
  await page.locator('[data-editor-workflow-command="inspect.measure"]').click();
  const a = await canvasPoint(page, 0, 0);
  const b = await canvasPoint(page, 10, 0);
  await page.mouse.move(a.x + 3, a.y - 2);
  await expect(page.locator('[data-preview-measurement-snap]')).toHaveAttribute('data-preview-measurement-snap', 'endpoint');
  await page.mouse.click(a.x + 3, a.y - 2);
  await page.mouse.click(b.x - 3, b.y - 2);
  // The result list and canvas must agree, including sign and display precision.
  await expect(page.locator('dl[aria-label="Point measurements"]')).toContainText('Distance10.000 mm');
  await expect(page.locator('[data-preview-measurement-distance]')).toHaveText('10.000 mm');
  await page.getByLabel('Measurement precision').selectOption('5');
  await expect(page.locator('[data-preview-measurement-distance]')).toHaveText('10.00000 mm');
  await page.getByRole('button', { name: 'Zoom preview out', exact: true }).click();
  await page.getByRole('button', { name: 'Zoom preview out', exact: true }).click();
  await page.getByLabel('Measurement repeat mode').selectOption('chain');
  const midpoint = await canvasPoint(page, 5, 0);
  await page.mouse.click(midpoint.x, midpoint.y - 2);
  await expect(page.locator('dl[aria-label="Point measurements"]')).toContainText('ΔX-5.00000 mm');
  await page.getByLabel('Measurement repeat mode').selectOption('fixed');
  const zoomedA = await canvasPoint(page, 0, 0);
  await page.mouse.click(zoomedA.x + 3, zoomedA.y - 2);
  await expect(page.locator('[data-preview-measurement-distance]')).toHaveText('10.00000 mm');
  await page.getByRole('button', { name: 'Clear measurement', exact: true }).click();
  await expect(page.getByText('Pick the first point on the canvas.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Hide Measure', exact: true }).click();
  await expect(page.locator('[data-editor-document-state]')).toHaveText('Saved');
  await expect(page.getByRole('button', { name: 'Undo active document change', exact: true })).toBeDisabled();
  expect(await page.locator('path[data-preview-segment]').evaluateAll((paths) => paths.map((path) => path.getAttribute('d')))).toEqual(geometry);
});

test('supports touch picks and free-point measurement when snapping is disabled', async ({ page }) => {
  await openRectangle(page);
  await page.getByRole('button', { name: 'Construction menu' }).click();
  await page.locator('[data-editor-workflow-command="inspect.measure"]').click();
  await page.getByLabel('Snap to geometry', { exact: true }).uncheck();
  const a = await canvasPoint(page, 2, 1);
  const b = await canvasPoint(page, 5, 5);
  await page.touchscreen.tap(a.x, a.y);
  await page.touchscreen.tap(b.x, b.y);
  await expect(page.locator('[data-editor-measure-panel]')).toContainText('A · Free point');
  // Touch coordinates are rounded to screen pixels, so verify at display-appropriate tolerance.
  const readout = await page.locator('[data-preview-measurement-distance]').textContent();
  expect(parseFloat(readout ?? '')).toBeCloseTo(5, 1);
  await expect(page.locator('[data-editor-document-state]')).toHaveText('Saved');
});

test('keeps geometry endpoint hover visible above coincident start and end markers', async ({ page }) => {
  await openRectangle(page);
  await page.getByRole('tab', { name: 'Geometry lens', exact: true }).click();
  await page.getByRole('button', { name: /Expand cut path in/ }).first().click();
  await page.getByRole('button', { name: /Expand segment 1 details in/ }).first().click();
  const start = page.locator('[data-upid-point-row][data-upid-point-role="start"]').first();
  await start.hover();
  const ring = page.locator('[data-preview-point-emphasis="hover"]').first();
  await expect(ring).toBeVisible();
  const layering = await ring.evaluate((element) => {
    const marker = document.querySelector('[data-path-marker="start"]');
    const dot = marker?.querySelector('circle');
    return {
      afterMarker: Boolean(marker && (marker.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING)),
      surroundsMarker: Number(element.getAttribute('r')) > Number(dot?.getAttribute('r')),
      sameX: element.getAttribute('cx') === dot?.getAttribute('cx'),
      sameY: element.getAttribute('cy') === dot?.getAttribute('cy')
    };
  });
  expect(layering).toEqual({ afterMarker: true, surroundsMarker: true, sameX: true, sameY: true });
});
