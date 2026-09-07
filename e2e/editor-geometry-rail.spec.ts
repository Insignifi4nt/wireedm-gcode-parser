import { expect, test } from '@playwright/test';
import { confirmPendingDxfImport } from './dxf-import';

test('geometry navigation uses the full rail height and follows viewport resizing', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Go Build!', exact: true }).click();
  await page.getByLabel('DXF file', { exact: true }).setInputFiles('examples/robofil-100-v2/no-lead-rectangle.dxf');
  await confirmPendingDxfImport(page);
  await page.getByRole('tab', { name: 'Geometry lens', exact: true }).click();
  const rail = page.locator('[data-app-rail-expanded-content]');
  const navigator = rail.locator('[data-upid-path-navigator]');
  for (const height of [720, 1000]) {
    await page.setViewportSize({ width: 1280, height });
    await expect.poll(async () => {
      const outer = await rail.boundingBox();
      const inner = await navigator.boundingBox();
      return outer && inner ? outer.height - inner.height : Infinity;
    }).toBeLessThanOrEqual(33);
  }
  await page.getByRole('button', { name: 'Expand cut path in Exterior 1', exact: true }).click();
  const segment = rail.locator('[data-upid-segment-id]').first();
  await expect(segment).toBeVisible();
  await page.screenshot({ path: 'tmp/cam-audit/14-geometry-rail-height.png' });
});
