import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { confirmPendingDxfImport } from './dxf-import';
import { readWorkbenchCacheFile, writeWorkbenchCacheFiles } from './fixtures/workbench-cache';

test('downloads original readable files from blocked startup through hosted Settings without rewriting storage', async ({ page }) => {
  const originals = { 'workbench.json': '\uFEFF{"schemaVersion":3,', 'transactions/workbench-files.json': '{interrupted', 'imports/original.nc': '\uFEFFG90\r\nG1 X2 Y3\r\n' };
  await page.addInitScript(files => {
    for (const [path, text] of Object.entries(files)) localStorage.setItem(`wire-edm-workbench:file:${path}`, text);

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

test('copies retained historical files from connected storage when verified backup cannot validate them', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: undefined }));
  await page.goto('/');
  await expect(page.getByLabel('DXF file', { exact: true })).toBeEnabled();
  await page.getByLabel('DXF file').setInputFiles('tests/fixtures/machine-packages/robofil-100-v2/no-lead-rectangle.dxf');
  await confirmPendingDxfImport(page);
  await page.getByRole('button', { name: 'Back to Dashboard' }).click();
  const catalog = JSON.parse(await readWorkbenchCacheFile(page, 'workbench.json'));
  const projectId = catalog.projects[0].id;
  const projectPath = `projects/${projectId}.json`;
  const project = JSON.parse(await readWorkbenchCacheFile(page, projectPath));
  const revisionId = 'revision.retained-history';
  project.savedRevisionIds = [revisionId];
  const revisionPath = `projects/${projectId}/revisions/${revisionId}.wireedm-job.json`;
  const originals = {
    [projectPath]: `\uFEFF${JSON.stringify(project)}\r\n`,
    [revisionPath]: '\uFEFF{"format":"wire-edm-job-revision","schemaVersion":1,"engineVersion":"2"}\r\n'
  };
  await writeWorkbenchCacheFiles(page, originals);
  await page.reload();
  await expect(page.getByRole('button', { name: /^Open project / })).toHaveCount(1);
  await page.getByRole('button', { name: 'Open settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Workbench settings' });
  await expect(dialog).toContainText('Browser cache active');
  await dialog.getByRole('button', { name: 'Create and download backup', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText(`Revision ${revisionId}`);
  await expect(dialog.getByText('If a verified backup cannot be created, use Export readable recovery files below.', { exact: false })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Choose Workbench Folder', exact: true })).toHaveAccessibleDescription(/folder access is optional/);
  const request = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Capture and download recovery export', exact: true }).click();
  const download = await request;
  const archive = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(archive.format).toBe('wire-edm-recovery-export');
  expect(archive.source.diagnostic.code).toBe('CONNECTED_WORKBENCH_RECOVERY_COPY');
  expect(archive.contentComplete).toBe(true);
  for (const [path, text] of Object.entries(originals)) {
    expect(archive.files).toContainEqual(expect.objectContaining({ path, status: 'captured', text,
      utf8Sha256: createHash('sha256').update(text, 'utf8').digest('hex') }));
    expect(await readWorkbenchCacheFile(page, path)).toBe(text);
  }
  await expect(dialog.getByText('Recovery export download requested. Check that the file was saved.')).toBeVisible();
  await page.screenshot({ path: 'tmp/2026-10-13-improvements/connected-recovery-export.png', fullPage: true });
  const retry = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download captured recovery export again', exact: true }).click();
  const repeated = await retry;
  expect(await readFile((await repeated.path())!, 'utf8')).toBe(JSON.stringify(archive));
});
