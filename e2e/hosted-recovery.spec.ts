import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

test('downloads original readable files from blocked startup through hosted Settings without rewriting storage', async ({ page }) => {
  const originals = { 'workbench.json': '\uFEFF{"schemaVersion":3,', 'transactions/workbench-files.json': '{interrupted', 'imports/original.nc': '\uFEFFG90\r\nG1 X2 Y3\r\n' };
  await page.addInitScript(files => {
    for (const [path, text] of Object.entries(files)) localStorage.setItem(`wire-edm-workbench:file:${path}`, text);
    localStorage.setItem('wireedm.onboarding.dismissed', 'true');
  }, originals);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Workbench could not be opened' })).toBeVisible();
  await page.getByRole('button', { name: 'Open settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Workbench settings' });
  await expect(dialog.getByRole('heading', { name: 'Export readable recovery files' })).toBeVisible();
  const request = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Capture and download recovery export', exact: true }).click();
  const download = await request;
  expect(download.suggestedFilename()).toMatch(/\.wireedm-recovery\.json$/);
  const text = await readFile((await download.path())!, 'utf8'); const archive = JSON.parse(text);
  expect(archive.format).toBe('wire-edm-recovery-export'); expect(archive.contentComplete).toBe(true);
  for (const [path, original] of Object.entries(originals)) {
    expect(archive.files).toContainEqual(expect.objectContaining({ path, status: 'captured', text: original,
      utf8Sha256: createHash('sha256').update(original, 'utf8').digest('hex') }));
  }
  await expect(dialog.getByText('Recovery export download requested. Check that the file was saved.')).toBeVisible();
  await expect(dialog.getByText(`Archive SHA-256: ${createHash('sha256').update(text, 'utf8').digest('hex')}`)).toBeVisible();
  const observed = await page.evaluate(paths => Object.fromEntries(paths.map(path => [path, localStorage.getItem(`wire-edm-workbench:file:${path}`)])), Object.keys(originals));
  expect(observed).toEqual(originals);
});
