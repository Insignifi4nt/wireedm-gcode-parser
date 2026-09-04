import { expect, test } from '@playwright/test';

import { confirmPendingDxfImport } from './dxf-import';

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
    'examples/robofil-100-v2/cristian-robofil-100-v2.wireedm-package'
  );

  const preview = page.locator('[data-machine-package-preview]');
  await expect(preview).toContainText("Cristian's Robofil 100 V2 candidate package");
  await expect(preview).toContainText("Machine: Cristian's Charmilles Robofil 100");
  await expect(preview).toContainText('Posts: Cristian Robofil 100 V2 candidate 2.2.0');
  await expect(preview).toContainText(
    '.iso · CRLF · ASCII · final newline · N10 +10 · 1 prefix / 0 suffix marker'
  );
  await preview.getByRole('button', { name: 'Install machine package' }).click();

  await expect(page.getByRole('heading', { name: "Cristian's Charmilles Robofil 100" })).toBeVisible();
  await expect(page.getByText('Robofil V2 candidate 2.2.0', { exact: true })).toBeVisible();
  await expect(page.getByText('Saved and verified from storage.')).toBeVisible();

  const stored = await page.evaluate(() => ({
    machines: JSON.parse(localStorage.getItem('wire-edm-workbench:file:machines/library.json') ?? '{}'),
    posts: JSON.parse(localStorage.getItem('wire-edm-workbench:file:posts/library.json') ?? '{}')
  }));
  expect(stored.machines.machines).toHaveLength(1);
  expect(stored.machines.machines[0]).toMatchObject({
    id: 'cristian.robofil-100',
    activeBindingId: 'robofil-v2-candidate-2-2-0',
    bindings: [{ post: { packageId: 'cristian.robofil-100.v2-candidate', version: '2.2.0' } }]
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
    'examples/robofil-100-v2/cristian-robofil-100-v2.wireedm-package'
  );
  await page
    .locator('[data-machine-package-preview]')
    .getByRole('button', { name: 'Install machine package' })
    .click();
  await page.getByRole('button', { name: 'Close settings' }).click();

  await page.getByLabel('DXF file').setInputFiles(
    'examples/robofil-100-v2/no-lead-rectangle.dxf'
  );
  await confirmPendingDxfImport(page);

  await page.getByRole('button', { name: 'Geometry menu' }).click();
  await page.locator('[data-editor-workflow-command="geometry.setup"]').click();
  await page.getByLabel('Geometry basis').selectOption('finished-contour');
  await page.getByRole('button', { name: 'Save Geometry Setup workflow' }).click();

  await page.getByRole('button', { name: 'Machining menu' }).click();
  await page.locator('[data-editor-workflow-command="machining.initial-wire"]').click();
  await page.getByLabel('Initial wire X').fill('-5');
  await page.getByLabel('Initial wire Y').fill('0');
  await page.getByRole('button', { name: 'Review and set manual initial wire position' }).click();
  await page.getByRole('button', { name: 'Save Initial wire position workflow' }).click();
  await page.getByRole('button', { name: 'Save active document' }).click();

  await page.getByRole('button', { name: 'Export menu' }).click();
  await page.locator('[data-editor-workflow-command="export.preview"]').click();
  await page.getByLabel('Controller export machine').selectOption('cristian.robofil-100');
  await page.getByRole('button', { name: 'Generate controller artifact' }).click();

  const failure = page.getByRole('alert');
  await expect(failure).toContainText('CONTROLLER_ARTIFACT_POST_FAILED');
  await expect(failure).toContainText('POST_CUSTOM_RUNTIME_FAILED');
  await expect(failure).toContainText('Cutting motion requires active compensation.');

  await page.getByRole('button', { name: 'Close controller artifact export' }).click();
  await page.getByRole('button', { name: 'Machining menu' }).click();
  await page.locator('[data-editor-workflow-command="machining.contour-setup"]').click();
  await page.getByLabel('Compensation kept material').selectOption('outside');
  await page.getByRole('button', { name: 'Save Contour Setup workflow' }).click();
  await page.getByRole('button', { name: 'Save active document' }).click();

  await page.getByRole('button', { name: 'Export menu' }).click();
  await page.locator('[data-editor-workflow-command="export.preview"]').click();
  await page.getByLabel('Controller export machine').selectOption('cristian.robofil-100');
  await page.getByRole('button', { name: 'Generate controller artifact' }).click();

  await expect(page.getByRole('dialog', { name: 'Controller artifact export' }).locator('pre'))
    .toContainText('N10 G92 X-5.000 Y0.000');
});
