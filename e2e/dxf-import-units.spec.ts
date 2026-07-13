import { expect, test, type Page } from '@playwright/test';

import { createDefaultMachineProfile } from '../src/domain/workbench/defaultProject';
import { confirmPendingDxfImport } from './dxf-import';

test('uses declared DXF units, opens only after confirmation, and preserves provenance after reopen', async ({ page }) => {
  await openReadyWorkbench(page);

  await page.locator('input[aria-label="DXF file"]').setInputFiles({
    name: 'declared-inch.dxf',
    mimeType: 'application/dxf',
    buffer: Buffer.from(lineDxf(1))
  });

  const dialog = page.getByRole('dialog', { name: 'Review DXF import' });
  await expect(dialog).toBeVisible();
  await expect(page.locator('[data-editor-context="path-project"]')).toHaveCount(0);
  await expect(dialog.getByText('Declared by DXF')).toBeVisible();
  await expect(dialog.getByLabel('DXF units')).toHaveValue('inches');
  await expect(dialog.getByTestId('dxf-import-size')).toContainText('25.400 × 0.000 mm');

  await confirmPendingDxfImport(page, 'inches');
  await expect(page.locator('[data-editor-context="path-project"]')).toBeVisible();
  await expect(page.locator('[data-editor-status-units]')).toContainText('inches ×25.4');

  const projectId = await page.evaluate(() => {
    const manifest = JSON.parse(
      localStorage.getItem('wire-edm-workbench:file:workbench.json') ?? '{}'
    );
    const entry = manifest.projects[0];
    const project = JSON.parse(
      localStorage.getItem(`wire-edm-workbench:file:${entry.path}`) ?? '{}'
    );
    if (project.upid.document.source.unitDeclaration.status !== 'recognized') {
      throw new Error('Declared unit provenance was not persisted.');
    }
    if (project.upid.document.source.appliedUnits.basis !== 'dxf-declared') {
      throw new Error('Applied declared-unit provenance was not persisted.');
    }
    return entry.id as string;
  });

  await page.getByRole('button', { name: 'Back to Dashboard' }).click();
  await page.getByRole('button', { name: `Open project ${projectId} in editor` }).click();
  await expect(page.locator('[data-editor-status-units]')).toContainText('inches ×25.4');

  await page.getByRole('button', { name: 'Open UPID export preview' }).click();
  const trace = page.locator('[data-upid-export-document-trace]');
  await expect(trace).toHaveAttribute('data-upid-export-document-unit-declaration', 'recognized');
  await expect(trace).toHaveAttribute('data-upid-export-document-applied-units', 'inches');
  await expect(trace).toHaveAttribute('data-upid-export-document-applied-scale', '25.4');
  await expect(trace).toHaveAttribute('data-upid-export-document-applied-basis', 'dxf-declared');
});

test('confirms unitless DXF with a one-off machine while leaving the default unchanged', async ({ page }) => {
  await openReadyWorkbench(page);
  const defaultProfile = createDefaultMachineProfile();
  const inchProfile = createDefaultMachineProfile();
  inchProfile.id = 'e2e-inch-suggestion';
  inchProfile.name = 'E2E Inch Suggestion';
  inchProfile.preferredDxfImportUnit = 'inches';
  inchProfile.workArea = { widthMm: 20, lengthMm: 20 };
  await seedMachineProfiles(page, [defaultProfile, inchProfile], defaultProfile.id);

  await page.locator('input[aria-label="DXF file"]').setInputFiles({
    name: 'unitless-machine-choice.dxf',
    mimeType: 'application/dxf',
    buffer: Buffer.from(lineDxf())
  });
  const dialog = page.getByRole('dialog', { name: 'Review DXF import' });
  await expect(dialog.getByText('Not declared')).toBeVisible();
  await expect(dialog.getByLabel('DXF units')).toHaveValue('millimeters');
  await expect(page.locator('[data-editor-context="path-project"]')).toHaveCount(0);

  await dialog.getByLabel('Machine profile').selectOption(inchProfile.id);
  await dialog.getByLabel('DXF units').selectOption('inches');
  await expect(dialog.getByTestId('dxf-import-size')).toContainText('25.400 × 0.000 mm');
  await expect(dialog.locator('[data-dxf-import-machine-fit="too-large"]')).toBeVisible();
  await dialog.getByRole('button', { name: 'Import and open' }).click();
  await expect(page.locator('[data-editor-context="path-project"]')).toBeVisible();

  await page.evaluate(({ defaultId, selectedId }) => {
    const manifest = JSON.parse(
      localStorage.getItem('wire-edm-workbench:file:workbench.json') ?? '{}'
    );
    const entry = manifest.projects[0];
    const project = JSON.parse(
      localStorage.getItem(`wire-edm-workbench:file:${entry.path}`) ?? '{}'
    );
    if (manifest.activeMachineProfileId !== defaultId) {
      throw new Error('One-off machine selection changed the workbench default.');
    }
    if (project.machine.id !== selectedId) {
      throw new Error('Selected machine was not snapshotted into the project.');
    }
    const applied = project.upid.document.source.appliedUnits;
    if (
      applied.basis !== 'user-confirmed' ||
      applied.scaleToMillimeters !== 25.4 ||
      applied.suggestion?.profileId !== selectedId
    ) {
      throw new Error('Unitless confirmation provenance is incomplete.');
    }
  }, { defaultId: defaultProfile.id, selectedId: inchProfile.id });
});

test('cancels DXF review without writes or editor navigation', async ({ page }) => {
  await openReadyWorkbench(page);
  const before = await workbenchStorageSnapshot(page);

  await page.locator('input[aria-label="DXF file"]').setInputFiles({
    name: 'cancel-unit-review.dxf',
    mimeType: 'application/dxf',
    buffer: Buffer.from(lineDxf())
  });
  const dialog = page.getByRole('dialog', { name: 'Review DXF import' });
  await expect(dialog).toBeVisible();
  await expect(page.locator('[data-editor-context="path-project"]')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  await expect(dialog).toHaveCount(0);
  await expect(page.locator('[data-editor-context="path-project"]')).toHaveCount(0);
  expect(await workbenchStorageSnapshot(page)).toEqual(before);
});

test('blocks a project-snapshotted G20 profile at UPID preview and download', async ({ page }) => {
  await openReadyWorkbench(page);
  const g20Profile = createDefaultMachineProfile();
  g20Profile.id = 'e2e-g20-upid';
  g20Profile.name = 'E2E G20 UPID';
  g20Profile.controller.unitsCode = 'G20';
  await seedMachineProfiles(page, [g20Profile], g20Profile.id);

  await page.locator('input[aria-label="DXF file"]').setInputFiles({
    name: 'g20-blocked.dxf',
    mimeType: 'application/dxf',
    buffer: Buffer.from(rectangleDxf(4))
  });
  await confirmPendingDxfImport(page, 'millimeters');
  await page.getByRole('button', { name: 'Open UPID export preview' }).click();

  await expect(page.locator('[data-upid-export-readiness="blocked"]')).toBeVisible();
  await expect(
    page.locator('[data-upid-export-blocking-code="post-inch-units-unsupported"]')
  ).toContainText('G20 inch output is unavailable');
  await expect(page.getByRole('button', { name: 'Download UPID export program' })).toBeDisabled();
  await expect(page.locator('[data-upid-export-program-section="body"]')).toHaveCount(0);
  await expect(page.locator('[data-upid-export-operation-row]')).toHaveCount(0);
  await expect(page.locator('[data-upid-export-move-row]')).toHaveCount(0);
});

async function openReadyWorkbench(page: Page) {
  await page.goto('/');
  await expect(page.locator('input[aria-label="DXF file"]')).toBeEnabled();
}

async function seedMachineProfiles(
  page: Page,
  profiles: ReturnType<typeof createDefaultMachineProfile>[],
  activeProfileId: string
) {
  const active = profiles.find((profile) => profile.id === activeProfileId);
  if (!active) throw new Error('Active E2E machine profile is missing.');
  await page.evaluate(({ activeProfile, machineProfiles }) => {
    const manifestKey = 'wire-edm-workbench:file:workbench.json';
    const manifest = JSON.parse(localStorage.getItem(manifestKey) ?? '{}');
    manifest.activeMachineProfileId = activeProfile.id;
    manifest.machineProfiles = machineProfiles;
    manifest.output = activeProfile.output;
    localStorage.setItem(manifestKey, JSON.stringify(manifest, null, 2));
    localStorage.setItem(
      'wire-edm-workbench:file:templates/header.gcode',
      activeProfile.templates.header
    );
    localStorage.setItem(
      'wire-edm-workbench:file:templates/footer.gcode',
      activeProfile.templates.footer
    );
  }, { activeProfile: active, machineProfiles: profiles });
  await page.reload();
  await expect(page.locator('input[aria-label="DXF file"]')).toBeEnabled();
}

async function workbenchStorageSnapshot(page: Page) {
  return page.evaluate(() => {
    const entries: Array<[string, string | null]> = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith('wire-edm-workbench:')) entries.push([key, localStorage.getItem(key)]);
    }
    return entries.sort(([left], [right]) => left.localeCompare(right));
  });
}

function lineDxf(unitsCode?: number) {
  return [
    '0', 'SECTION', '2', 'HEADER',
    ...(unitsCode == null ? [] : ['9', '$INSUNITS', '70', String(unitsCode)]),
    '0', 'ENDSEC',
    '0', 'SECTION', '2', 'ENTITIES',
    '0', 'LINE', '10', '0', '20', '0', '11', '1', '21', '0',
    '0', 'ENDSEC', '0', 'EOF'
  ].join('\n');
}

function rectangleDxf(unitsCode?: number) {
  return [
    '0', 'SECTION', '2', 'HEADER',
    ...(unitsCode == null ? [] : ['9', '$INSUNITS', '70', String(unitsCode)]),
    '0', 'ENDSEC',
    '0', 'SECTION', '2', 'ENTITIES',
    '0', 'LWPOLYLINE', '90', '4', '70', '1',
    '10', '0', '20', '0',
    '10', '10', '20', '0',
    '10', '10', '20', '5',
    '10', '0', '20', '5',
    '0', 'ENDSEC', '0', 'EOF'
  ].join('\n');
}
