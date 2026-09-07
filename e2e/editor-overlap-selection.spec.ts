import { expect, test, type Page } from '@playwright/test';
import { confirmPendingDxfImport } from './dxf-import';

test('cycles overlapping source edges and applies exact marquee and type filters without editing', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Go Build!', exact: true }).click();
  await page.getByLabel('DXF file').setInputFiles({
    name: 'overlap-selection.dxf', mimeType: 'application/dxf',
    buffer: Buffer.from('0\nSECTION\n2\nENTITIES\n0\nCIRCLE\n8\nCUT\n10\n0\n20\n0\n40\n5\n0\nLINE\n8\nCUT\n10\n-10\n20\n0\n11\n10\n21\n0\n0\nLINE\n8\nCUT\n10\n20\n20\n-5\n11\n20\n21\n5\n0\nENDSEC\n0\nEOF\n')
  });
  await confirmPendingDxfImport(page);
  await expect(page.locator('[data-preview-selection-tools]')).toContainText('Alt-click cycles overlaps');
  const selected = page.locator('path[data-preview-segment][data-preview-selected="true"]').first();
  const crossing = await worldPoint(page, 5, 0);
  await page.keyboard.down('Alt');
  await page.mouse.click(crossing.x, crossing.y);
  const first = await selected.getAttribute('data-preview-segment');
  await expect(page.locator('[data-preview-overlap-selection]')).toContainText('/2');
  await page.mouse.click(crossing.x, crossing.y);
  const second = await selected.getAttribute('data-preview-segment');
  expect(second).not.toBe(first);
  await page.mouse.click(crossing.x, crossing.y);
  await expect(selected).toHaveAttribute('data-preview-segment', first!);
  await page.keyboard.up('Alt');
  await page.screenshot({ path: 'tmp/cam-audit/19-overlap-candidates.png' });

  await page.getByLabel('Canvas selection filter').selectOption('line');
  const remote = await worldPoint(page, 20, 0);
  await page.mouse.click(remote.x, remote.y);
  const remoteId = await selected.getAttribute('data-preview-segment');
  const circleTop = await worldPoint(page, 0, 5);
  await page.mouse.click(circleTop.x, circleTop.y);
  await expect(selected).toHaveAttribute('data-preview-segment', remoteId!);

  await page.getByLabel('Canvas selection filter').selectOption('circle');
  await marquee(page, -1, -1, 1, 1);
  await expect(selected).toHaveAttribute('data-preview-segment', remoteId!);
  await marquee(page, 3, 3, 4, 4);
  await expect(selected).toHaveAttribute('data-type', 'arc');
  await expect(page.locator('[data-editor-document-state]')).toHaveText('Saved');
  await page.screenshot({ path: 'tmp/cam-audit/18-overlap-selection.png' });
});

async function worldPoint(page: Page, x: number, y: number) {
  return page.locator('[data-preview-grid-layer]').evaluate((grid, point) => {
    const matrix = (grid as SVGGraphicsElement).getScreenCTM();
    if (!matrix) throw new Error('Canvas transform unavailable');
    const screen = new DOMPoint(point.x, point.y).matrixTransform(matrix);
    return { x: screen.x, y: screen.y };
  }, { x, y });
}

async function marquee(page: Page, x1: number, y1: number, x2: number, y2: number) {
  const from = await worldPoint(page, x1, y1), to = await worldPoint(page, x2, y2);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
}
