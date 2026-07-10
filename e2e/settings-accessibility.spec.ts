import { expect, test } from '@playwright/test';

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1024, height: 720 }
]) {
  test(`settings traps focus and preserves truthful cache status at ${viewport.width}px`, async ({
    page
  }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');

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
    await expect(page.locator('[data-app-status-bar]')).toHaveAttribute('aria-hidden', 'true');
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
