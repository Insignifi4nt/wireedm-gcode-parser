import { expect, test } from '@playwright/test';

test('compact settings keeps navigation and a working backup action in view', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 800 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Go Build!', exact: true }).click();
  await page.getByRole('button', { name: 'Open settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Workbench settings', exact: true });
  await expect(dialog.getByRole('button', { name: 'Storage', exact: true })).toBeInViewport();
  await expect(dialog.getByRole('button', { name: 'Machines & setups', exact: true })).toBeInViewport();
  const backup = dialog.getByRole('button', { name: 'Create and download backup', exact: true });
  await expect(backup).toBeInViewport();
  const downloadPromise = page.waitForEvent('download');
  await backup.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.wireedm-backup\.json$/);
  await expect(dialog.getByRole('status')).toContainText('Verified backup download requested');
  await dialog.getByRole('button', { name: 'Machines & setups', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Install a machine package', exact: true })).toBeInViewport();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Open settings', exact: true })).toBeFocused();
});

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1024, height: 720 }
]) {
  test(`settings traps focus and preserves truthful cache status at ${viewport.width}px`, async ({
    page
  }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');

    const onboarding = page.getByRole('dialog', { name: 'Thanks for trying Wire EDM Workbench' });
    await expect(onboarding).toBeVisible();
    await expect(onboarding.getByRole('button', { name: 'Close onboarding' })).toBeFocused();
    await expect(page.locator('[data-app-header]')).toHaveAttribute('inert', '');
    await page.keyboard.press('Shift+Tab');
    await expect(onboarding.getByRole('button', { name: 'Go Build!' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(onboarding.getByRole('button', { name: 'Close onboarding' })).toBeFocused();
    await onboarding.getByRole('button', { name: 'Go Build!' }).click();
    await expect(page.getByRole('button', { name: 'Open Editor' })).toBeVisible();

    const storageBadge = page.locator('[data-storage-status-label]');
    await expect(storageBadge).toHaveText('Browser cache active');
    await expect(storageBadge.locator('..')).not.toHaveClass(/destructive/);

    const settingsButton = page.getByRole('button', { name: 'Open settings' });
    await settingsButton.focus();
    await settingsButton.click();

    const dialog = page.getByRole('dialog', { name: 'Workbench settings' });
    const closeButton = dialog.getByRole('button', { name: 'Close settings' });
    await expect(dialog).toBeVisible();
    await expect(closeButton).toBeFocused();
    await expect(page.locator('[data-app-header]')).toHaveAttribute('aria-hidden', 'true');
    await expect(page.locator('[data-app-workspace-grid]')).toHaveAttribute('aria-hidden', 'true');
    expect(
      await page
        .locator('[data-app-header]')
        .evaluate((element) => (element as HTMLElement).inert)
    ).toBe(true);

    await page.keyboard.press('Shift+Tab');
    await expect(closeButton).not.toBeFocused();
    expect(
      await page.evaluate(() =>
        Boolean(document.activeElement?.closest('[role="dialog"][aria-label="Workbench settings"]'))
      )
    ).toBe(true);
    await page.keyboard.press('Tab');
    await expect(closeButton).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(settingsButton).toBeFocused();
    await expect(page.locator('[data-app-header]')).not.toHaveAttribute('aria-hidden', 'true');
    expect(
      await page
        .locator('[data-app-header]')
        .evaluate((element) => (element as HTMLElement).inert)
    ).toBe(false);
    await expect(storageBadge).toHaveText('Browser cache active');

    await settingsButton.click();
    await expect(closeButton).toBeFocused();
    const overlay = page.locator('[data-workbench-settings-overlay]');
    const overlayBox = await overlay.boundingBox();
    expect(overlayBox).not.toBeNull();
    await page.mouse.click(overlayBox!.x + 2, overlayBox!.y + 2);
    await expect(dialog).toHaveCount(0);
    await expect(settingsButton).toBeFocused();
  });
}
