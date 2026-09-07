import { expect, test, type Page } from '@playwright/test';

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
  await expect(temporary.locator('[data-storage-status]')).toHaveAttribute('aria-label', 'Temporary storage only');
  await temporary.getByRole('button', { name: 'Open settings', exact: true }).click();
  await expect(temporary.getByRole('dialog')).toContainText('cannot coordinate persistent edits across tabs');
  await expect(temporary.getByRole('dialog')).toContainText('Existing browser-cache projects are untouched');
  await temporary.screenshot({ path: 'tmp/cam-audit/15-temporary-storage-reason.png', fullPage: true });
  await temporary.getByRole('button', { name: 'Close settings', exact: true }).click();
  await temporary.getByLabel('Machine program file', { exact: true }).setInputFiles(program('temporary.nc', 12));
  await expect(temporary.locator('[data-editor-context="machine-program"]')).toBeVisible();
  await temporary.locator('details[data-editor-code-section="text"] summary').click();
  await temporary.getByLabel('Program editor').fill('G21 G90\nG0 X0 Y0\nG1 X24 Y5');
  await temporary.getByRole('button', { name: 'Save active document', exact: true }).click();
  await expect(temporary.locator('[data-editor-document-state]')).toHaveText('Saved');
  await temporary.getByRole('button', { name: 'Back to Dashboard', exact: true }).click();
  await temporary.getByRole('button', { name: /^Open project / }).click();
  await temporary.locator('details[data-editor-code-section="text"] summary').click();
  await expect(temporary.getByLabel('Program editor')).toHaveValue('G21 G90\nG0 X0 Y0\nG1 X24 Y5');
  expect(await cache(temporary)).toEqual(before);
  await temporary.reload();
  await dismissOnboarding(temporary);
  await expect(temporary.locator('[data-storage-status]')).toHaveAttribute('aria-label', 'Temporary storage only');
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
