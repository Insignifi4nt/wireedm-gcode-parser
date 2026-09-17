import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { confirmPendingDxfImport } from './dxf-import';

test('keeps dense gear endpoints and grid labels readable across zoom and a narrow canvas', async ({ page }) => {
  test.setTimeout(90_000);
  await mkdir('tmp/cam-audit', { recursive: true });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Go Build!', exact: true }).click();
  await page.locator('input[aria-label="DXF file"]').setInputFiles({
    name: 'dense-gear-scale.dxf', mimeType: 'application/dxf', buffer: Buffer.from(denseGearDxf())
  });
  await confirmPendingDxfImport(page);
  const allEndpoints = page.locator('[data-preview-path-endpoint]');
  const visibleEndpoints = page.locator('[data-preview-visible-endpoint]');
  await expect(allEndpoints).toHaveCount(1296);
  expect(await visibleEndpoints.count()).toBeLessThan(500);
  await expect(page.locator('[data-preview-grid-label="x"]').first()).toBeVisible();
  const endpoint = visibleEndpoints.first();
  const endpointWidth = (await endpoint.boundingBox())!.width;
  const labelHeight = (await page.locator('[data-preview-grid-label="x"]').first().boundingBox())!.height;
  expect(endpointWidth).toBeGreaterThan(2);
  expect(endpointWidth).toBeLessThan(7);
  expect(labelHeight).toBeGreaterThan(8);
  expect(labelHeight).toBeLessThan(20);
  await page.screenshot({ path: 'tmp/cam-audit/dense-gear-overview-after.png' });
  await allEndpoints.nth(100).click({ force: true });
  await expect(page.locator('[data-editor-status-selected-point]')).toContainText('Selected X');
  await expect(page.locator('[data-preview-visible-endpoint]')).not.toHaveCount(0);

  for (let index = 0; index < 8; index += 1) {
    await page.getByRole('button', { name: 'Zoom preview in' }).click();
  }
  expect((await visibleEndpoints.first().boundingBox())!.width).toBeCloseTo(endpointWidth, 1);
  await page.screenshot({ path: 'tmp/cam-audit/dense-gear-interior-after.png' });

  for (let index = 0; index < 2; index += 1) {
    await page.getByRole('button', { name: 'Zoom preview in' }).click();
  }
  expect((await visibleEndpoints.first().boundingBox())!.width).toBeCloseTo(endpointWidth, 1);
  await page.screenshot({ path: 'tmp/cam-audit/dense-gear-tooth-after.png' });

  await page.setViewportSize({ width: 800, height: 720 });
  expect((await visibleEndpoints.first().boundingBox())!.width).toBeCloseTo(endpointWidth, 1);
  await page.screenshot({ path: 'tmp/cam-audit/dense-gear-narrow-after.png' });
});

function denseGearDxf() {
  const contour = (count: number, radius: (angle: number) => number) => {
    const points = Array.from({ length: count }, (_, index) => {
      const angle = index * Math.PI * 2 / count;
      const r = radius(angle);
      return { x: Number((Math.cos(angle) * r).toFixed(6)),
        y: Number((Math.sin(angle) * r).toFixed(6)) };
    });
    return points.map((point, index) => {
      const next = points[(index + 1) % count];
      return `0\nLINE\n8\nCUT\n10\n${point.x}\n20\n${point.y}\n11\n${next.x}\n21\n${next.y}`;
    }).join('\n');
  };
  return `0\nSECTION\n2\nENTITIES\n${contour(360, (angle) =>
    70 + 1.2 * Math.cos(angle * 45))}\n${contour(288, (angle) =>
    7 + 0.6 * Math.cos(angle * 36))}\n0\nENDSEC\n0\nEOF\n`;
}
