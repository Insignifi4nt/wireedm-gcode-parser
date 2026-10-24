import { expect, test } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { prepareCadTools, rawCadToolCall } from './cad-tool-helpers';
import { createUpidFromDxfEntities } from '../src/domain/upid/upidDocument';

test('selects a 4363-segment contour without flooding the canvas and retains exact segment inspection', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1400, height: 900 });
  await prepareCadTools(page);
  const count = 4_363;
  const point = (index: number) => {
    const angle = index / count * Math.PI * 2;
    const radius = 55 + 9 * Math.cos(angle * 7);
    return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
  };
  const document = createUpidFromDxfEntities(Array.from({ length: count }, (_, index) => ({
    type: 'line', layer: 'CUT', start: point(index), end: point((index + 1) % count)
  })));
  await page.getByLabel('UPID path project file', { exact: true }).setInputFiles({
    name: 'dense-contour.upid.json', mimeType: 'application/json',
    buffer: process.env.WIRE_EDM_DENSITY_PRIVATE_UPID ? await readFile(process.env.WIRE_EDM_DENSITY_PRIVATE_UPID)
      : Buffer.from(JSON.stringify({ format: 'upid', schemaVersion: document.schemaVersion, document }))
  });
  const svg = page.locator('svg[data-preview-model="upid"]');
  await expect(svg).toBeVisible();
  const before = await rawCadToolCall(page, 'edm_get_context');
  const box = await svg.boundingBox();
  if (!box) throw new Error('Missing canvas bounds');
  const left = box.x + 20, top = box.y + 20;
  const start = performance.now();
  await page.mouse.move(left, top);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 20, box.y + box.height - 20, { steps: 4 });
  await page.mouse.up();
  await expect(svg.locator('path[data-preview-selected="true"]')).toHaveCount(count);
  await expect(svg.locator('[data-preview-path-point-label]')).toHaveCount(0);
  await expect(svg.locator('[data-preview-path-endpoint]')).toHaveCount(0);
  await expect(svg.locator('[data-preview-arc-center-handle]')).toHaveCount(0);
  console.info(JSON.stringify({ segments: count, selectionRoundTripMs: performance.now() - start,
    svgNodes: await svg.locator('*').count(), labels: 0, endpointTargets: 0 }));
  await mkdir('tmp/contour-density', { recursive: true });
  await page.screenshot({ path: 'tmp/contour-density/selected-contour-desktop.png' });

  // A click on an exact source edge still exposes that edge and both endpoints.
  const edgePoint = await svg.locator('path[data-preview-selected="true"]').nth(200).evaluate((element: SVGPathElement) => {
    const point = element.getPointAtLength(element.getTotalLength() / 2);
    const transform = element.getScreenCTM();
    if (!transform) throw new Error('Missing path screen transform');
    const screen = new DOMPoint(point.x, point.y).matrixTransform(transform);
    return { x: screen.x, y: screen.y };
  });
  await page.mouse.click(edgePoint.x, edgePoint.y);
  await expect(svg.locator('[data-preview-path-point-label]')).toHaveCount(1);
  await expect(svg.locator('[data-preview-path-endpoint]')).toHaveCount(2);
  await svg.locator('[data-preview-path-endpoint][data-preview-point-role="end"]').click({ force: true });
  await expect(page.locator('[data-editor-status-selected-point]')).toContainText('Selected X');
  const after = await rawCadToolCall(page, 'edm_get_context');
  expect(after.data.draft).toEqual(before.data.draft);
  await page.setViewportSize({ width: 800, height: 720 });
  await expect(svg.locator('[data-preview-path-endpoint]')).toHaveCount(2);
  await page.screenshot({ path: 'tmp/contour-density/selected-point-narrow.png' });
});
