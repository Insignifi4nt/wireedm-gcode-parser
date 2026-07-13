import path from 'node:path';

import { expect, test } from '@playwright/test';

const gearFixture = path.resolve('DXF-test-subjects/z39motocicleta.dxf');

test('reviews and exports the real z39 gear with reversal-safe Robofil compensation', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('input[aria-label="DXF file"]')).toBeEnabled();

  const profile = verifiedRobofilProfile();
  await page.evaluate((verifiedProfile) => {
    const manifestKey = 'wire-edm-workbench:file:workbench.json';
    const manifest = JSON.parse(localStorage.getItem(manifestKey) ?? '{}');
    manifest.activeMachineProfileId = verifiedProfile.id;
    manifest.machineProfiles = [verifiedProfile];
    manifest.output = verifiedProfile.output;
    localStorage.setItem(manifestKey, JSON.stringify(manifest, null, 2));
    localStorage.setItem('wire-edm-workbench:file:templates/header.gcode', '');
    localStorage.setItem('wire-edm-workbench:file:templates/footer.gcode', '');
  }, profile);
  await page.reload();
  await expect(page.locator('input[aria-label="DXF file"]')).toBeEnabled();

  await page.locator('input[aria-label="DXF file"]').setInputFiles(gearFixture);
  await expect(page.locator('[data-editor-context="path-project"]')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'z39motocicleta' })).toBeVisible();

  await page.getByRole('button', { name: 'Select Exterior 1' }).click();
  const geometryBasis = page.locator('select[aria-label="Geometry basis"]:visible').first();
  await expect(geometryBasis).toHaveValue('wire-centre');
  await geometryBasis.selectOption('finished-contour');

  const keptMaterial = page.locator('[data-testid="compensation-kept-material"]:visible').first();
  const compensationCode = page.locator('[data-testid="compensation-code"]:visible').first();
  await expect(keptMaterial).toContainText('inside · automatic');
  const before = await compensationCode.textContent();
  await expect(compensationCode).toContainText(/G4[12] D0/);

  await page.locator('button[aria-label="Reverse path operation"]:visible').first().click();
  await expect(compensationCode).not.toHaveText(before ?? '');
  await expect(keptMaterial).toContainText('inside');

  await page.locator('button[aria-label="Open UPID export preview"]:visible').first().click();
  await expect(page.locator('[data-upid-export-readiness="ready"]')).toBeVisible();
  await expect(page.locator('[data-upid-export-block-kind="setup"]')).not.toHaveCount(0);
  await expect(page.locator('[data-upid-export-block-kind="compensation-activation"]')).not.toHaveCount(0);
  await expect(page.locator('[data-upid-export-block-kind="contour"]')).not.toHaveCount(0);
  await expect(page.locator('[data-upid-export-block-kind="program-end"]')).toContainText('M02');
  await expect(page.locator('[data-upid-export-block-kind="lead-out"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Download UPID export program' })).toBeEnabled();
});

function verifiedRobofilProfile() {
  const controller = {
    family: 'charmilles-robofil-classic',
    postVersion: 1,
    verification: { status: 'unverified' },
    blockFormatting: 'spaced',
    coordinateSystem: 'wire-position-g92',
    unitsCode: 'omit',
    planeCode: 'omit',
    workOffsetCode: 'omit',
    distanceMode: 'G90',
    arcCenterMode: 'absolute',
    programEnd: 'M02'
  };
  const compensation = {
    supported: true,
    enabledByDefault: true,
    offsetSelection: { address: 'D', index: 0 },
    activation: 'charmilles-g38',
    cancellation: 'program-end',
    lifecycleScope: 'program',
    preActivationCodes: ['G60'],
    validationLeadLengthMm: 2,
    expectedMaximumOffsetMm: 0.5
  };
  const templates = { header: '', footer: '' };
  const output = { extension: 'iso', lineEnding: 'crlf', coordinatePrecision: 3 };
  const verifiedFingerprint = JSON.stringify({
    family: controller.family,
    postVersion: controller.postVersion,
    blockFormatting: controller.blockFormatting,
    coordinateSystem: controller.coordinateSystem,
    unitsCode: controller.unitsCode,
    planeCode: controller.planeCode,
    workOffsetCode: controller.workOffsetCode,
    distanceMode: controller.distanceMode,
    arcCenterMode: controller.arcCenterMode,
    programEnd: controller.programEnd,
    supported: compensation.supported,
    enabledByDefault: compensation.enabledByDefault,
    offsetSelection: compensation.offsetSelection,
    activation: compensation.activation,
    cancellation: compensation.cancellation,
    lifecycleScope: compensation.lifecycleScope,
    preActivationCodes: compensation.preActivationCodes,
    templates,
    lineEnding: output.lineEnding,
    coordinatePrecision: output.coordinatePrecision
  });

  return {
    id: 'z39-playwright-robofil',
    name: 'Charmilles Robofil 100 / Classic (verified 2026-07-13)',
    controller: {
      ...controller,
      verification: {
        status: 'user-verified',
        verifiedAt: '2026-07-13T00:00:00.000Z',
        verifiedFingerprint
      }
    },
    compensation,
    templates,
    output,
    workArea: { widthMm: null, lengthMm: null },
    notes: 'Playwright snapshot of the checked-in physically verified preset.'
  };
}
