import { expect, test } from '@playwright/test';

test('imports mixed unit motion at its physical scale and preserves it on reopen', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Go Build!', exact: true }).click();
  await page.getByLabel('Machine program file', { exact: true }).setInputFiles({
    name: 'mixed-units.nc', mimeType: 'text/plain',
    buffer: Buffer.from('G20 G90\nG0 X0 Y0\nG1 X1 Y0\nG21 G1 X25.4 Y10\nM30')
  });
  const cutting = page.locator('path[data-preview-source="gcode"][data-type="cut"]');
  await expect(cutting.first()).toHaveAttribute('d', 'M 0 0 L 25.4 0');
  await expect(cutting.nth(1)).toHaveAttribute('d', 'M 25.4 0 L 25.4 10');
  await expect(page.locator('[data-editor-status-units]')).toHaveText('mm');
  await page.getByRole('button', { name: 'Back to Dashboard', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: /Open project .* in editor/ }).click();
  await expect(cutting.first()).toHaveAttribute('d', 'M 0 0 L 25.4 0');
  await expect(cutting.nth(1)).toHaveAttribute('d', 'M 25.4 0 L 25.4 10');
  await expect(page.locator('[data-editor-status-units]')).toHaveText('mm');
});
