import { expect, test, type Page } from '@playwright/test';
import { confirmPendingDxfImport } from './dxf-import';

test.use({ hasTouch: true });

test('inspects either picked feature without replacing the measured pair', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Go Build!', exact: true }).click();
  await page.getByLabel('DXF file').setInputFiles({
    name: 'two-circles.dxf', mimeType: 'application/dxf',
    buffer: Buffer.from('0\nSECTION\n2\nENTITIES\n0\nCIRCLE\n8\nCUT\n10\n0\n20\n0\n40\n5\n0\nCIRCLE\n8\nCUT\n10\n20\n20\n0\n40\n3\n0\nENDSEC\n0\nEOF\n')
  });
  await confirmPendingDxfImport(page);
  await page.getByRole('button', { name: 'Construction menu' }).click();
  await page.locator('[data-editor-workflow-command="inspect.measure"]').click();
  await page.getByRole('button', { name: 'Dock Measure right', exact: true }).click();
  const a = await canvasPoint(page, 0, 0);
  const b = await canvasPoint(page, 20, 0);
  await page.mouse.click(a.x, a.y);
  await page.mouse.click(b.x, b.y);
  const dimensions = page.getByLabel('Selected geometry measurements', { exact: true });
  await expect(dimensions).toContainText('Diameter6.000 mm');
  const bReference = await dimensions.locator('[data-measurement-reference]').textContent();
  await page.getByRole('button', { name: 'Inspect A', exact: true }).click();
  await expect(dimensions).toContainText('Diameter10.000 mm');
  expect(await dimensions.locator('[data-measurement-reference]').textContent()).not.toBe(bReference);
  await expect(page.getByLabel('Point measurements', { exact: true })).toContainText('Point distance20.000 mm');
  await expect(page.getByLabel('Feature measurements', { exact: true })).toContainText('Minimum feature gap12.000 mm');
  await expect(page.getByLabel('Feature measurements', { exact: true })).toContainText('Center distance20.000 mm');
  const connector = page.locator('[data-preview-feature-gap] line');
  await expect(connector).toHaveAttribute('x1', '5');
  await expect(connector).toHaveAttribute('x2', '17');
  await page.getByRole('button', { name: 'Inspect B', exact: true }).click();
  await expect(dimensions).toContainText('Diameter6.000 mm');
  await expect(dimensions.locator('[data-measurement-reference]')).toHaveText(bReference!);
  await expect(page.locator('[data-preview-measurement-distance]')).toHaveText('20.000 mm');
  await expect(page.locator('[data-editor-document-state]')).toHaveText('Saved');
  await page.screenshot({ path: 'tmp/cam-audit/12-measure-feature-references.png' });
});

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
  const disclosure = page.getByText('Contour dimensions', { exact: true });
  const disclosureBox = await disclosure.boundingBox();
  if (!disclosureBox) throw new Error('Contour disclosure unavailable');
  // Use the position seen on the canvas; entering the panel must not move the target.
  await page.mouse.click(disclosureBox.x + 20, disclosureBox.y + disclosureBox.height / 2);
  await expect(page.locator('dl[aria-label="Contour measurements"]')).toBeVisible();
  await disclosure.click();
  await page.mouse.click(b.x - 3, b.y - 2);
  // The result list and canvas must agree, including sign and display precision.
  await expect(page.locator('dl[aria-label="Point measurements"]')).toContainText('Point distance10.000 mm');
  await expect(page.locator('[data-preview-measurement-distance]')).toHaveText('10.000 mm');
  await page.getByText('Contour dimensions', { exact: true }).click();
  const contour = page.locator('dl[aria-label="Contour measurements"]');
  await expect(contour).toContainText('Boundary length40.000 mm');
  await expect(contour).toContainText('Width10.000 mm');
  await expect(contour).toContainText('Height10.000 mm');
  await expect(contour).toContainText('Enclosed area100.000 mm²');
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
