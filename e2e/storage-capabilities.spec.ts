import { expect, test, type Page } from '@playwright/test';

test('starts and edits temporary projects when the localStorage getter is denied', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { configurable: true, get: () => {
      throw new DOMException('Storage access denied', 'SecurityError');
    } });
    Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: undefined });
  });
  await page.goto('/');
  const onboarding = page.getByRole('dialog', { name: 'Thanks for trying Wire EDM Workbench', exact: true });
  await expect(onboarding).toBeVisible({ timeout: 5000 });
  await onboarding.getByRole('button', { name: 'Go Build!', exact: true }).click();
  await page.getByRole('button', { name: 'Open settings', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Temporary storage');
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  await page.getByLabel('Machine program file', { exact: true }).setInputFiles(program('temporary-denied.nc', 12));
  await expect(page.locator('[data-editor-context="machine-program"]')).toBeVisible();
  await page.getByRole('tab', { name: 'Text', exact: true }).click();
  await page.getByLabel('Program editor').fill('G21 G90\nG0 X0 Y0\nG1 X24 Y5');
  await page.getByRole('button', { name: 'Save active document', exact: true }).click();
  await expect(page.locator('[data-editor-document-state]')).toHaveText('Saved');
  expect(errors).toEqual([]);
});

test('keeps passive layout persistence failures out of temporary editor workflows', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    Reflect.set(window, 'layoutWriteAttempts', 0);
    Storage.prototype.setItem = function (key: string) {
      if (key === 'wire-edm.editor-workspace-layout.v1') Reflect.set(window, 'layoutWriteAttempts', Reflect.get(window, 'layoutWriteAttempts') + 1);
      throw new DOMException('Storage is full', 'QuotaExceededError');
    };
    Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: undefined });
  });
  await ready(page);
  await page.getByLabel('Machine program file', { exact: true }).setInputFiles(program('temporary-quota.nc', 12));
  await expect(page.locator('[data-editor-context="machine-program"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => Reflect.get(window, 'layoutWriteAttempts'))).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('keeps existing cache untouched without Web Locks while temporary imports remain editable', async ({ page, context }) => {
  await ready(page);
  await page.getByLabel('Machine program file', { exact: true }).setInputFiles(program('retained.nc', 10));
  await expect(page.locator('[data-editor-context="machine-program"]')).toBeVisible();
  const before = await cache(page);
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
    Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: undefined });
  });
  const temporary = await context.newPage();
  await ready(temporary);
  await temporary.getByRole('button', { name: 'Open settings', exact: true }).click();
  await expect(temporary.getByRole('dialog')).toContainText('Temporary storage');
  await expect(temporary.getByRole('dialog')).toContainText('cannot coordinate persistent edits across tabs');
  await expect(temporary.getByRole('dialog')).toContainText('Existing browser-cache projects are untouched');
  await temporary.screenshot({ path: 'tmp/cam-audit/15-temporary-storage-reason.png', fullPage: true });
  await temporary.getByRole('button', { name: 'Close settings', exact: true }).click();
  await temporary.getByLabel('Machine program file', { exact: true }).setInputFiles(program('temporary.nc', 12));
  await expect(temporary.locator('[data-editor-context="machine-program"]')).toBeVisible();
  await temporary.getByRole('tab', { name: 'Text', exact: true }).click();
  await temporary.getByLabel('Program editor').fill('G21 G90\nG0 X0 Y0\nG1 X24 Y5');
  await temporary.getByRole('button', { name: 'Save active document', exact: true }).click();
  await expect(temporary.locator('[data-editor-document-state]')).toHaveText('Saved');
  await temporary.getByRole('button', { name: 'Back to Dashboard', exact: true }).click();
  await temporary.getByRole('button', { name: /^Open project / }).click();
  await temporary.getByRole('tab', { name: 'Text', exact: true }).click();
  await expect(temporary.getByLabel('Program editor')).toHaveValue('G21 G90\nG0 X0 Y0\nG1 X24 Y5');
  expect(await cache(temporary)).toEqual(before);
  await temporary.reload();
  await dismissOnboarding(temporary);
  await temporary.getByRole('button', { name: 'Open settings', exact: true }).click();
  await expect(temporary.getByRole('dialog')).toContainText('Temporary storage');
  await temporary.getByRole('button', { name: 'Close settings', exact: true }).click();
  await expect(temporary.getByRole('button', { name: /^Open project / })).toHaveCount(0);
  expect(await cache(temporary)).toEqual(before);
});

test('waits for a lock held by another tab before importing into the shared browser cache', async ({ page, context }) => {
  await ready(page);
  const second = await context.newPage();
  await ready(second);
  const before = await cache(second);
  await page.evaluate(async () => {
    await new Promise<void>((entered) => {
      void navigator.locks.request('wire-edm-workbench:browser-storage:wire-edm-workbench', async () => {
        const gate = new Promise<void>((release) => Reflect.set(window, 'releaseStorageTestLock', release));
        entered();
        await gate;
      });
    });
  });
  await second.getByLabel('Machine program file', { exact: true }).setInputFiles(program('queued.nc', 8));
  await expect(second.getByLabel('Machine program file', { exact: true })).toBeDisabled();
  expect(await cache(second)).toEqual(before);
  await page.evaluate(() => Reflect.get(window, 'releaseStorageTestLock')());
  await expect(second.locator('[data-editor-context="machine-program"]')).toBeVisible();
  const after = await cache(second);
  expect(after.filter(([key]) => key.includes(':file:imports/'))).toHaveLength(1);
  await page.reload();
  await dismissOnboarding(page);
  await expect(page.getByRole('button', { name: /^Open project / })).toHaveCount(1);
});

async function ready(page: Page) {
  await page.goto('/');
  await dismissOnboarding(page);
  await expect(page.getByLabel('Machine program file', { exact: true })).toBeEnabled();
}
async function dismissOnboarding(page: Page) {
  const dismissed = await page.evaluate(() => localStorage.getItem('wireedm.onboarding.dismissed') === 'true');
  const dialog = page.getByRole('dialog', { name: 'Thanks for trying Wire EDM Workbench', exact: true });
  if (!dismissed) {
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Go Build!', exact: true }).click();
  }
  await expect(dialog).toHaveCount(0);
}
function program(name: string, x: number) {
  return { name, mimeType: 'text/plain', buffer: Buffer.from(`G21 G90\nG0 X0 Y0\nG1 X${x} Y5`) };
}
function cache(page: Page) {
  return page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith('wire-edm-workbench:')).sort(([a], [b]) => a.localeCompare(b)));
}
