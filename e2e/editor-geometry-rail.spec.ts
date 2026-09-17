import { expect, test } from '@playwright/test';
import { confirmPendingDxfImport } from './dxf-import';

test('resizes the project rail and workflow dock with keyboard without editing geometry', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Go Build!', exact: true }).click();
  await page.getByLabel('DXF file').setInputFiles('tests/fixtures/machine-packages/robofil-100-v2/no-lead-rectangle.dxf');
  await confirmPendingDxfImport(page);
  const divider = page.getByRole('separator', { name: 'Resize project rail', exact: true });
  await divider.focus();
  const initial = Number(await divider.getAttribute('aria-valuenow'));
  await page.keyboard.press('ArrowRight');
  await expect(divider).toHaveAttribute('aria-valuenow', String(initial + 10));
  await page.keyboard.press('Shift+ArrowLeft');
  await expect(divider).toHaveAttribute('aria-valuenow', String(initial + 9));
  await page.keyboard.press('Home');
  await expect(divider).toHaveAttribute('aria-valuenow', (await divider.getAttribute('aria-valuemin'))!);
  await page.keyboard.press('End');
  await expect(divider).toHaveAttribute('aria-valuenow', (await divider.getAttribute('aria-valuemax'))!);
  await page.getByRole('button', { name: 'Construction menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Measure', exact: true }).click();
  await page.getByRole('button', { name: 'Dock Measure right', exact: true }).click();
  const dockDivider = page.getByRole('separator', { name: 'Resize Workflow Dock', exact: true });
  await dockDivider.focus();
  const dockInitial = Number(await dockDivider.getAttribute('aria-valuenow'));
  await page.keyboard.press('ArrowLeft');
  await expect(dockDivider).toHaveAttribute('aria-valuenow', String(dockInitial + 10));
  await page.keyboard.press('Home');
  await expect(dockDivider).toHaveAttribute('aria-valuenow', '280');
  await page.keyboard.press('ArrowRight');
  await expect(dockDivider).toHaveAttribute('aria-valuenow', '280');
  await expect(page.locator('[data-editor-document-state]')).toHaveText('Saved');
  await expect(page.getByRole('button', { name: 'Undo active document change', exact: true })).toBeDisabled();
});

test('geometry navigation uses the full rail height and follows viewport resizing', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Go Build!', exact: true }).click();
  await page.getByLabel('DXF file', { exact: true }).setInputFiles('tests/fixtures/machine-packages/robofil-100-v2/no-lead-rectangle.dxf');
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
