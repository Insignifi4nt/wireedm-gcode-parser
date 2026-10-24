import { expect, test, type Page } from '@playwright/test';
import { confirmPendingDxfImport } from './dxf-import';

test.use({ hasTouch: true });

async function openTouchProject(page: Page, geometry: 'line' | 'circle' = 'line') {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/');
  await expect(page.getByLabel('DXF file', { exact: true })).toBeEnabled();
  await page.getByLabel('DXF file').setInputFiles({
    name: `touch-${geometry}.dxf`, mimeType: 'application/dxf',
    buffer: Buffer.from(geometry === 'circle'
      ? '0\nSECTION\n2\nENTITIES\n0\nCIRCLE\n8\nCUT\n10\n0\n20\n0\n40\n5\n0\nENDSEC\n0\nEOF\n'
      : '0\nSECTION\n2\nENTITIES\n0\nLINE\n8\nCUT\n10\n0\n20\n0\n11\n10\n21\n10\n0\nENDSEC\n0\nEOF\n')
  });
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

for (const changeTarget of [false, true]) {
  test(`touch entry pick ${changeTarget ? 'cancels when its target changes' : 'survives cursor updates'}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await openTouchProject(page);
    await page.getByRole('button', { name: 'Machining menu' }).click();
    await page.locator('[data-editor-workflow-command="machining.entry-exit"]').click();
    await page.getByRole('button', { name: 'Dock Entry / Exit right', exact: true }).click();
    const entry = page.getByRole('button', { name: 'Pick entry point on canvas', exact: true });
    const exit = page.getByRole('button', { name: 'Pick exit point on canvas', exact: true });
    await entry.click();
    await expect(page.locator('[data-editor-document-state]')).toHaveText('Saved');
    const point = await canvasPoint(page, 1, 8);
    await page.touchscreen.tap(point.x, point.y);
    if (changeTarget) {
      await exit.click();
      // The pending single-tap delay is 500 ms. Observe beyond it before checking
      // that the old entry pick neither mutates the draft nor clears the new target.
      await page.waitForTimeout(650);
      await expect(page.locator('[data-editor-document-state]')).toHaveText('Saved');
      await expect(exit).toHaveAttribute('aria-pressed', 'true');
    } else {
      await expect(page.locator('[data-editor-document-state]')).toHaveText('Unsaved');
      await expect(entry).toHaveAttribute('aria-pressed', 'false');
      await expect(page.locator('[data-entry-strategy]')).toContainText('straight entry');
    }
    expect(errors).toEqual([]);
  });
}

test('keeps both distinct construction taps across the first callback render', async ({ page }) => {
  await openTouchProject(page);
  await page.getByRole('button', { name: 'Construction menu' }).click();
  await page.locator('[data-editor-workflow-command="construction.measurement"]').click();
  await page.getByRole('button', { name: 'Dock Construction points right', exact: true }).click();
  await page.locator('button[data-editor-canvas-mouse-mode-point]').click();
  const first = await canvasPoint(page, 1, 8);
  const second = await canvasPoint(page, 8, 1);
  await page.touchscreen.tap(first.x, first.y);
  await page.waitForTimeout(100);
  await page.touchscreen.tap(second.x, second.y);
  await expect(page.locator('[data-measurement-point-row]')).toHaveCount(2);
});

test('does not recreate a deleted source from a pending perpendicular touch pick', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.clock.install({ time: new Date('2026-10-11T09:00:00Z') });
  await openTouchProject(page);
  await page.getByRole('button', { name: 'Construction menu' }).click();
  await page.locator('[data-editor-workflow-command="construction.measurement"]').click();
  await page.getByRole('button', { name: 'Dock Construction points right', exact: true }).click();
  await page.locator('button[data-editor-canvas-mouse-mode-point]').click();
  const source = await canvasPoint(page, 1, 8);
  await page.touchscreen.tap(source.x, source.y);
  await expect(page.locator('[data-measurement-point-row]')).toHaveCount(1);
  const perpendicular = page.getByRole('button', { name: 'Magnetize latest point perpendicular', exact: true });
  await perpendicular.click();
  const target = await canvasPoint(page, 5, 5);
  const deletion = page.getByRole('button', { name: 'Delete measurement point P1', exact: true });
  await expect(deletion).toBeVisible();
  const deletionBox = await deletion.boundingBox();
  if (!deletionBox) throw new Error('Source deletion control is unavailable');

  // Pause only after loading and positioning controls. Native taps need no
  // actionability animation frames, so the cancellation always precedes expiry.
  await page.clock.pauseAt(new Date('2026-10-11T10:00:00Z'));
  await page.touchscreen.tap(target.x, target.y);
  await page.touchscreen.tap(deletionBox.x + deletionBox.width / 2, deletionBox.y + deletionBox.height / 2);
  await expect(page.locator('[data-measurement-point-row]')).toHaveCount(0);
  await page.clock.runFor(650);
  await expect(page.locator('[data-measurement-point-row]')).toHaveCount(0);
  await expect(perpendicular).toHaveAttribute('aria-pressed', 'true');
  expect(errors).toEqual([]);
});

test('keeps the saved circle when inference changes during a pending start touch pick', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.clock.install({ time: new Date('2026-10-11T09:00:00Z') });
  await openTouchProject(page, 'circle');
  await page.getByRole('button', { name: 'Machining menu' }).click();
  await page.locator('[data-editor-workflow-command="machining.set-start"]').click();
  await page.getByRole('button', { name: 'Dock Contour Start right', exact: true }).click();
  const inference = page.getByLabel('Set start point inference', { exact: true });
  await inference.selectOption('nearest');
  await page.getByRole('button', { name: 'Pick explicit contour start', exact: true }).click();
  const target = await canvasPoint(page, 0, 5);
  await page.mouse.move(target.x, target.y);
  await expect(page.locator('[data-upid-start-preview-point]')).toBeVisible();
  const sourceSegments = await page.locator('path[data-preview-segment]').evaluateAll(paths =>
    [...new Set(paths.map(path => path.getAttribute('data-preview-segment')))].sort());
  expect(sourceSegments).toHaveLength(1);

  await page.clock.pauseAt(new Date('2026-10-11T10:00:00Z'));
  await page.touchscreen.tap(target.x, target.y);
  await inference.selectOption('endpoint');
  await page.clock.runFor(650);
  await expect(page.locator('[data-editor-document-state]')).toHaveText('Saved');
  expect(await page.locator('path[data-preview-segment]').evaluateAll(paths =>
    [...new Set(paths.map(path => path.getAttribute('data-preview-segment')))].sort())).toEqual(sourceSegments);
  await expect(inference).toHaveValue('endpoint');
  expect(errors).toEqual([]);
});
