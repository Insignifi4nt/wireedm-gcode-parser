import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { prepareCadTools } from './cad-tool-helpers';
import { readWorkbenchCache } from './fixtures/workbench-cache';

test('explains disabled folder and restore actions while saved-file backup works in an open editor', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: undefined }));
  await prepareCadTools(page);
  await page.getByLabel('Machine program file', { exact: true }).setInputFiles({ name: 'original.nc', mimeType: 'text/plain', buffer: Buffer.from('G21\r\nG90\r\nG1 X10 Y5\r\n') });
  await expect(page.getByRole('button', { name: 'Back to Dashboard', exact: true })).toBeVisible();
  const before = await readWorkbenchCache(page);
  await page.getByRole('button', { name: 'Open settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Workbench settings' });
  const folder = settings.getByRole('button', { name: 'Choose Workbench Folder', exact: true });
  await expect(folder).toBeDisabled();
  await expect(folder).toHaveAccessibleDescription(/This browser cannot open workbench folders/);
  const restore = settings.getByRole('button', { name: 'Choose backup to restore', exact: true });
  await expect(restore).toBeDisabled();
  await expect(restore).toHaveAccessibleDescription(/return to the dashboard/);
  const backup = settings.getByRole('button', { name: 'Create and download backup', exact: true });
  await expect(backup).toBeEnabled();
  await expect(settings.getByRole('button', { name: 'Capture and download recovery export', exact: true })).toBeEnabled();
  const requested = page.waitForEvent('download'); await backup.click();
  const downloaded = await requested;
  const archive = JSON.parse(await readFile((await downloaded.path())!, 'utf8'));
  expect(archive.files).toEqual(expect.arrayContaining(before.map(([key, text]) => expect.objectContaining({ path: key.slice('wire-edm-workbench:file:'.length), text }))));
  expect(await readWorkbenchCache(page)).toEqual(before);
});
