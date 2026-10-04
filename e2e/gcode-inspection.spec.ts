import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByRole('dialog', { name: 'Thanks for trying Wire EDM Workbench' })
    .getByRole('button', { name: 'Go Build!' }).click();
});

test('inspects original controller text without creating a project and links commands to lines', async ({ page }) => {
  await page.getByRole('button', { name: 'Inspect G-code', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'G-code inspection', exact: true });
  const original = '%\r\nN10 G21 G90\r\nN20 G0 X0 Y0\r\nN30 G1 X10 Y0\r\nN40 G39\r\nN50 M02\r\n%\r\n';
  await dialog.getByLabel('G-code inspection file', { exact: true }).setInputFiles({ name: 'check.nc', mimeType: 'text/plain', buffer: Buffer.from(original) });
  await expect(dialog.locator('[data-inspection-line] code')).toHaveText(original.split('\r\n').map((line) => line || ' '));
  await dialog.getByRole('button', { name: 'Commands (6)', exact: true }).click();
  await dialog.getByRole('button', { name: 'Inspect G39 occurrences' }).click();
  await expect(dialog.locator('[data-inspection-line]')).toHaveCount(1);
  await expect(dialog.locator('[data-inspection-line="5"]')).toHaveAttribute('aria-pressed', 'true');
  await dialog.getByLabel('Go to source line', { exact: true }).fill('4');
  await dialog.getByRole('button', { name: 'Go', exact: true }).click();
  await dialog.getByRole('button', { name: 'Line 4', exact: true }).click();
  await expect(dialog.getByRole('table', { name: 'Modal state at line 4' })).toContainText('G1');
  await expect(dialog.locator('path[data-line="4"]').first()).toHaveAttribute('stroke', '#38bdf8');
  await dialog.getByRole('button', { name: 'Close G-code inspection' }).click();
  await expect(page.getByRole('button', { name: 'Inspect G-code', exact: true })).toBeFocused();
  await expect(page.locator('[data-project-row]')).toHaveCount(0);
});

test('supports pasted programs, explicit assumptions and keyboard navigation at compact width', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.getByRole('button', { name: 'Inspect G-code', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'G-code inspection', exact: true });
  await dialog.getByLabel('G-code to inspect', { exact: true }).fill('G0 X0 Y0\nG1 X2 Y0\nG999 X50\nG1 X4 Y0');
  await dialog.getByRole('button', { name: 'Inspect pasted code' }).click();
  await dialog.getByLabel('Inspection initial units', { exact: true }).selectOption('in');
  await dialog.getByLabel('Go to source line', { exact: true }).fill('2');
  await dialog.getByLabel('Go to source line', { exact: true }).press('Enter');
  await expect(dialog.getByRole('table', { name: 'Modal state at line 2' })).toContainText('50.8');
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await dialog.getByRole('button', { name: 'Close G-code inspection' }).focus();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Inspect G-code', exact: true })).toBeFocused();
});
