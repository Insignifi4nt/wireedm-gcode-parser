import { expect, test } from '@playwright/test';
import { confirmPendingDxfImport } from './dxf-import';

test('clicking a clipped cut selects its source and exact active range', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Go Build!', exact: true }).click();
  await page.getByLabel('DXF file').setInputFiles('tests/fixtures/machine-packages/robofil-100-v2/no-lead-rectangle.dxf');
  await confirmPendingDxfImport(page);
  await page.getByRole('button', { name: 'Machining menu' }).click();
  await page.locator('[data-editor-workflow-command="machining.participation"]').click();
  await page.getByLabel('Machining span start', { exact: true }).fill('60');
  await page.getByLabel('Machining span end', { exact: true }).fill('100');
  await page.getByRole('button', { name: 'Mark inactive reference', exact: true }).click();
  await page.locator('[data-editor-workflow-actions="machining.participation"] button[aria-label^="Save "]').click();
  await page.getByRole('button', { name: 'Machining menu' }).click();
  await page.locator('[data-editor-workflow-command="machining.participation"]').click();
  const reference = page.locator('path[data-preview-participation="inactive-reference"]');
  const segmentId = await reference.getAttribute('data-preview-segment');
  const operationId = await reference.getAttribute('data-preview-operation');
  const clipped = page.locator('path[data-preview-participation="active-cut"][data-preview-segment="' + segmentId + '"]');
  await expect(clipped).toHaveCount(1);
  const point = await clipped.evaluate((element) => {
    const path = element as SVGPathElement;
    const local = path.getPointAtLength(path.getTotalLength() / 2);
    const screen = new DOMPoint(local.x, local.y).matrixTransform(path.getScreenCTM()!);
    return { x: screen.x, y: screen.y };
  });
  await page.mouse.click(point.x, point.y);
  await expect(clipped).toHaveAttribute('data-preview-selected', 'true');
  await expect(clipped).toHaveAttribute('data-preview-operation', operationId!);
  await expect(reference).not.toHaveAttribute('data-preview-selected', 'true');
  const selectedRange = page.locator('[data-machining-span-participation="active-cut"][aria-current="true"]');
  await expect(selectedRange).toHaveCount(1);
  await expect(selectedRange).toContainText('6.000 mm');
  await expect(page.locator('[data-preview-path-endpoint][cx="6"][data-preview-segment="' + segmentId + '"]')).toHaveCount(0);
  await page.screenshot({ path: 'tmp/cam-audit/13-partial-range.png', fullPage: true });
  await page.getByRole('button', { name: 'Construction menu' }).click();
  await page.locator('[data-editor-workflow-command="inspect.measure"]').click();
  await page.getByRole('button', { name: 'Dock Measure right', exact: true }).click();
  // Docking changes both the SVG size and its fitted viewBox via ResizeObserver.
  // Wait for the screen transform to settle before saving a mouse coordinate.
  const measurementPoint = await clipped.evaluate((element) => new Promise<{ x: number; y: number }>((resolve, reject) => {
    const path = element as SVGPathElement;
    let previous = '';
    let stableFrames = 0;
    function sample() {
      const matrix = path.getScreenCTM();
      if (!matrix) {
        reject(new Error('Clipped path transform unavailable'));
        return;
      }
      const signature = [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f].join(',');
      stableFrames = signature === previous ? stableFrames + 1 : 0;
      previous = signature;
      if (stableFrames < 2) {
        requestAnimationFrame(sample);
        return;
      }
      const local = path.getPointAtLength(path.getTotalLength() / 2);
      const screen = new DOMPoint(local.x, local.y).matrixTransform(matrix);
      resolve({ x: screen.x, y: screen.y });
    }
    requestAnimationFrame(sample);
  }));
  await page.mouse.click(measurementPoint.x, measurementPoint.y);
  await expect(page.getByLabel('Selected geometry measurements', { exact: true })).toContainText('Length10.000 mm');
  await expect(page.locator('[data-editor-measure-panel]')).toContainText('complete source geometry, including inactive ranges');
});
