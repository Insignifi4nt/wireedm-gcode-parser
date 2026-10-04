import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

import { confirmPendingDxfImport } from './dxf-import';
import { readWorkbenchCacheFile } from './fixtures/workbench-cache';

test('installs one complete Robofil machine package through the normal settings flow', async ({ page }) => {
  await page.goto('/');
  const onboarding = page.getByRole('dialog', { name: 'Thanks for trying Wire EDM Workbench' });
  await onboarding.waitFor({ state: 'visible', timeout: 2_000 }).catch(() => undefined);
  if (await onboarding.isVisible()) {
    await onboarding.getByRole('button', { name: 'Go Build!' }).click();
    await expect(onboarding).toHaveCount(0);
  }
  await expect(page.getByRole('button', { name: 'Open settings' })).toBeEnabled();
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Machines & setups' }).click();

  await page.getByLabel('Machine package file').setInputFiles(
    'tests/fixtures/machine-packages/robofil-100-v2/cristian-robofil-100-v2.wireedm-package'
  );

  const preview = page.locator('[data-machine-package-preview]');
  await expect(preview).toContainText("Cristian's Robofil 100 V2 candidate package");
  await expect(preview).toContainText("Machine: Cristian's Charmilles Robofil 100");
  await expect(preview).toContainText('Posts: Cristian Robofil 100 V2 candidate 2.6.0');
  await expect(preview).toContainText(
    '.iso · CRLF · ASCII · final newline · N10 +10 · 1 prefix / 0 suffix marker'
  );
  await preview.getByRole('button', { name: 'Install machine package' }).click();

  await expect(page.getByRole('heading', { name: "Cristian's Charmilles Robofil 100" })).toBeVisible();
  await expect(page.getByText('Robofil V2 candidate 2.6.0', { exact: true })).toBeVisible();
  await expect(page.getByText('Saved and verified from storage.')).toBeVisible();

  const stored = {
    machines: JSON.parse(await readWorkbenchCacheFile(page, 'machines/library.json')),
    posts: JSON.parse(await readWorkbenchCacheFile(page, 'posts/library.json'))
  };
  expect(stored.machines.machines).toHaveLength(1);
  expect(stored.machines.machines[0]).toMatchObject({
    id: 'cristian.robofil-100',
    activeBindingId: 'robofil-v2-candidate-2-6-0',
    bindings: [{ post: { packageId: 'cristian.robofil-100.v2-candidate', version: '2.6.0' } }]
  });
  expect(stored.posts.installations).toHaveLength(1);
  expect(stored.posts.installations[0].package.manifest.output).toMatchObject({
    fileExtension: 'iso',
    lineEnding: 'crlf',
    encoding: 'ascii',
    finalNewline: true,
    blockNumbering: { mode: 'sequential', prefix: 'N', start: 10 },
    programEnvelope: { prefix: ['%'], suffix: [] }
  });
});

test('explains missing compensation and exports after the decision is saved', async ({ page }) => {
  await page.goto('/');
  const onboarding = page.getByRole('dialog', { name: 'Thanks for trying Wire EDM Workbench' });
  await onboarding.waitFor({ state: 'visible', timeout: 2_000 }).catch(() => undefined);
  if (await onboarding.isVisible()) {
    await onboarding.getByRole('button', { name: 'Go Build!' }).click();
  }

  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Machines & setups' }).click();
  await page.getByLabel('Machine package file').setInputFiles(
    'tests/fixtures/machine-packages/robofil-100-v2/cristian-robofil-100-v2.wireedm-package'
  );
  await page
    .locator('[data-machine-package-preview]')
    .getByRole('button', { name: 'Install machine package' })
    .click();
  // File-input automation can bypass disabled controls; finish the intended install first.
  await expect(page.getByText('Saved and verified from storage.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close settings' }).click();

  await page.getByLabel('DXF file').setInputFiles(
    'tests/fixtures/machine-packages/robofil-100-v2/no-lead-rectangle.dxf'
  );
  await confirmPendingDxfImport(page);

  await page.getByRole('button', { name: 'Geometry menu' }).click();
  await page.locator('[data-editor-workflow-command="geometry.setup"]').click();
  await expect(page.getByLabel('Geometry basis')).toHaveValue('finished-contour');
  await page.getByRole('button', { name: 'Cancel Geometry Setup workflow' }).click();

  await page.getByRole('button', { name: 'Machining menu' }).click();
  await page.locator('[data-editor-workflow-command="machining.initial-wire"]').click();
  await page.getByLabel('Initial wire X').fill('-5');
  await page.getByLabel('Initial wire Y').fill('0');
  await page.getByRole('button', { name: 'Review and set manual initial wire position' }).click();
  await page.getByRole('button', { name: 'Apply Initial wire position workflow' }).click();
  await page.getByRole('button', { name: 'Save active document' }).click();

  await page.getByRole('button', { name: 'Export menu' }).click();
  await page.locator('[data-editor-workflow-command="export.preview"]').click();
  await page.getByLabel('Controller export machine').selectOption('cristian.robofil-100');
  await page.getByRole('button', { name: 'Generate controller artifact' }).click();

  const failure = page.getByRole('alert');
  await expect(failure).toContainText('CONTROLLER_ARTIFACT_EXECUTION_PLAN_INVALID');
  await expect(failure).toContainText('EXECUTION_PLAN_COMPENSATION_UNRESOLVED');
  await expect(failure).toContainText('needs an explicit controller compensation or wire-center choice');

  await page.getByRole('button', { name: 'Close controller artifact export' }).click();
  await page.getByRole('button', { name: 'Machining menu' }).click();
  await page.locator('[data-editor-workflow-command="machining.contour-setup"]').click();
  await page.getByLabel('Compensation kept material').selectOption('outside');
  await page.getByRole('button', { name: 'Apply Contour Setup workflow' }).click();
  await page.getByRole('button', { name: 'Save active document' }).click();

  await page.getByRole('button', { name: 'Export menu' }).click();
  await page.locator('[data-editor-workflow-command="export.preview"]').click();
  await page.getByLabel('Controller export machine').selectOption('cristian.robofil-100');
  await page.getByRole('button', { name: 'Generate controller artifact' }).click();

  const artifactDialog = page.getByRole('dialog', { name: 'Controller artifact export' });
  await expect(artifactDialog.locator('pre'))
    .toContainText('N10 G92 X-5.000 Y0.000');
  const preview = await artifactDialog.locator('pre').textContent();
  if (preview === null) throw new Error('Missing generated controller preview.');
  const downloaded = page.waitForEvent('download');
  await artifactDialog.getByRole('button', { name: /^Download / }).click();
  const download = await downloaded;
  const path = await download.path();
  if (path === null) throw new Error('Controller download has no local file.');
  const bytes = await readFile(path);
  expect(download.suggestedFilename()).toMatch(/\.iso$/);
  // The installed Robofil post owns ASCII, CRLF, the percent wrapper, and final newline.
  expect([...bytes].every((byte) => byte <= 0x7f)).toBe(true);
  expect(bytes.toString('ascii')).toMatch(/^%\r\nN10 G92 X-5\.000 Y0\.000\r\n/);
  expect(bytes.toString('ascii')).toMatch(/M02\r\n$/);
  expect(bytes.equals(Buffer.from(preview.replace(/\r?\n/g, '\r\n'), 'ascii'))).toBe(true);

  const persistedBeforeInspection = await page.evaluate(() => Object.keys(localStorage)
    .filter(key => key.startsWith('wire-edm-workbench:file:')).sort().map(key => [key, localStorage.getItem(key)]));
  await page.setViewportSize({ width: 360, height: 844 });
  expect(await artifactDialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await artifactDialog.locator('section').first().evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await artifactDialog.getByRole('button', { name: 'Inspect G-code', exact: true }).click();
  const inspector = page.getByRole('dialog', { name: 'G-code inspection', exact: true });
  await expect(inspector).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Controller artifact export' })).toHaveCount(0);
  await expect(inspector.getByLabel('Inspection initial units')).toHaveValue('mm');
  await expect(inspector.getByLabel('Inspection initial units')).toBeDisabled();
  await inspector.getByRole('button', { name: 'Context', exact: true }).click();
  await expect(inspector).toContainText('cristian.robofil-100.v2-candidate@2.6.0');
  await expect(inspector).toContainText('Saved revision');
  await expect(inspector).toContainText('Saved setup');
  const context = await inspector.locator('dl').textContent();
  await inspector.getByRole('button', { name: /^Commands / }).click();
  await expect(inspector).toContainText('compensation.finish: compensation.off');
  const inspectionDownloadPromise = page.waitForEvent('download');
  await inspector.getByRole('button', { name: 'Download exact file', exact: true }).click();
  const inspectionDownload = await inspectionDownloadPromise;
  expect(await readFile((await inspectionDownload.path())!)).toEqual(bytes);
  await inspector.getByRole('button', { name: 'Close G-code inspection', exact: true }).click();
  await expect(artifactDialog).toBeFocused();
  await expect(artifactDialog.locator('pre')).toHaveText(preview);
  expect(await page.evaluate(() => Object.keys(localStorage)
    .filter(key => key.startsWith('wire-edm-workbench:file:')).sort().map(key => [key, localStorage.getItem(key)])))
    .toEqual(persistedBeforeInspection);

  await artifactDialog.getByRole('button', { name: 'Close controller artifact export' }).click();
  await page.getByRole('button', { name: 'Back to Dashboard', exact: true }).click();
  await page.getByRole('button', { name: /^Show revisions for project / }).click();
  const revisionsDialog = page.getByRole('dialog', { name: /^Revisions for / });
  expect(await revisionsDialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await revisionsDialog.getByRole('button', { name: 'Inspect controller file', exact: true }).click();
  await expect(inspector).toBeVisible();
  await expect(revisionsDialog).toHaveCount(0);
  await inspector.getByRole('button', { name: 'Context', exact: true }).click();
  expect(await inspector.locator('dl').textContent()).toBe(context);
  const revisionDownloadPromise = page.waitForEvent('download');
  await inspector.getByRole('button', { name: 'Download exact file', exact: true }).click();
  const revisionDownload = await revisionDownloadPromise;
  expect(await readFile((await revisionDownload.path())!)).toEqual(bytes);
  await inspector.getByRole('button', { name: 'Close G-code inspection', exact: true }).click();
  await expect(revisionsDialog.getByRole('button', { name: 'Close revisions', exact: true })).toBeFocused();
  expect(await page.evaluate(() => Object.keys(localStorage)
    .filter(key => key.startsWith('wire-edm-workbench:file:')).sort().map(key => [key, localStorage.getItem(key)])))
    .toEqual(persistedBeforeInspection);
});
