import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { createVerifiedCharmillesRobofil100Profile } from '../src/domain/machine/machineProfiles';
import { confirmPendingDxfImport } from './dxf-import';

const gearFixture = path.resolve('DXF-test-subjects/z39motocicleta.dxf');

test('reviews and exports the real z39 gear with reversal-safe Robofil compensation', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('input[aria-label="DXF file"]')).toBeEnabled();

  const profile = createVerifiedCharmillesRobofil100Profile(
    'z39-playwright-robofil',
    new Date('2026-07-13T00:00:00.000Z')
  );
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
  await confirmPendingDxfImport(page, 'millimeters');
  await expect(page.locator('[data-editor-context="path-project"]')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'z39motocicleta' })).toBeVisible();

  await showPanel(page, 'path-transform');
  await page.locator('input[aria-label="Translate X"]:visible').fill('6.894299');
  await page.locator('input[aria-label="Translate Y"]:visible').fill('-19.024251');
  await page.getByRole('button', { name: 'Apply translation to document geometry' }).click();
  await page.getByRole('button', { name: 'Save Transform Geometry workflow' }).click();

  await openWorkflow(page, 'Geometry', 'geometry.setup');
  const geometryBasis = page.locator('select[aria-label="Geometry basis"]:visible').first();
  if (await geometryBasis.inputValue() === 'wire-centre') {
    await geometryBasis.selectOption('finished-contour');
    await page.getByRole('button', { name: 'Save Geometry Setup workflow' }).click();
  } else {
    await page.getByRole('button', { name: 'Cancel Geometry Setup workflow' }).click();
  }

  await page.locator(
    'li[data-tree-key="section:program"] > ul > li[role="treeitem"][data-tree-key^="operation:"]'
  ).first().getByRole('button', { name: /Edit 01/ }).click();
  await expect(page.locator('[data-editor-workspace-panel="contour-setup"]')).toBeVisible();

  const keptMaterial = page.locator('[data-testid="compensation-kept-material"]:visible').first();
  const compensationCode = page.locator('[data-testid="compensation-code"]:visible').first();
  await expect(keptMaterial).toContainText('inside · automatic');
  const before = await compensationCode.textContent();
  await expect(compensationCode).toContainText(/G4[12] D0/);

  await page.locator('button[aria-label="Reverse path operation"]:visible').first().click();
  await expect(compensationCode).not.toHaveText(before ?? '');
  await expect(keptMaterial).toContainText('inside');
  const compensationCodeText = (await compensationCode.textContent())!.trim();
  await page.getByRole('button', { name: 'Save Contour Setup workflow' }).click();

  await openWorkflow(page, 'Machining', 'machining.initial-wire');
  await page.getByLabel('Initial wire X').fill('0');
  await page.getByLabel('Initial wire Y').fill('0');
  await page.getByRole('button', { name: 'Review and set manual initial wire position' }).click();
  await page.getByRole('button', { name: 'Save Program Start / G92 workflow' }).click();

  await openWorkflow(page, 'Export', 'export.preview');
  await expect(page.locator('[data-upid-export-readiness="ready"]')).toBeVisible();
  await expect(page.locator('[data-upid-export-block-kind="setup"]')).not.toHaveCount(0);
  await expect(page.locator('[data-upid-export-block-kind="compensation-activation"]')).not.toHaveCount(0);
  await expect(page.locator('[data-upid-export-block-kind="contour"]')).not.toHaveCount(0);
  await expect(page.locator('[data-upid-export-block-kind="program-end"]')).toContainText('M02');
  await expect(page.locator('[data-upid-export-block-kind="lead-out"]')).toHaveCount(0);
  const downloadButton = page.getByRole('button', { name: 'Download UPID export program' });
  await expect(downloadButton).toBeEnabled();

  const downloadPromise = page.waitForEvent('download');
  await downloadButton.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^z39motocicleta-\d{4}-\d{2}-\d{2}\.iso$/);

  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const bytes = readFileSync(downloadPath!);
  const program = bytes.toString('utf8');
  const lines = program.split('\r\n');
  const nonEmptyLines = lines.filter(Boolean);

  expect(program.endsWith('M02\r\n')).toBe(true);
  expect(program).not.toMatch(/(?<!\r)\n/);
  expect(nonEmptyLines.slice(0, 5)).toEqual([
    'G92 X0.000 Y0.000',
    'G60',
    'G38',
    compensationCodeText,
    'G90'
  ]);
  expect(nonEmptyLines[5]).toBe('G1 X-1.200 Y-18.946');
  expect(nonEmptyLines.at(-1)).toBe('M02');
  const arcLines = nonEmptyLines.filter((line) => /^G[23] /.test(line));
  expect(arcLines).toHaveLength(78);
  expect(arcLines[0]).toBe('G2 X-1.857 Y-18.893 I0.000 J0.016');
  expect(arcLines).toEqual(
    expect.arrayContaining([
      expect.stringMatching(
        /^G[23] X-?\d+\.\d{3} Y-?\d+\.\d{3} I-?\d+\.\d{3} J-?\d+\.\d{3}$/
      )
    ])
  );
  expect(program).not.toMatch(/\b(?:G21|G17|G54|G40|M30)\b/);
  expect(nonEmptyLines.filter((line) => /\bD0\b/.test(line))).toHaveLength(1);
  for (const line of nonEmptyLines.filter((line) => line !== 'G92 X0 Y0')) {
    for (const word of line.matchAll(/\b[XYIJ](-?\d+(?:\.\d+)?)/g)) {
      expect(word[1]).toMatch(/^-?\d+\.\d{3}$/);
    }
  }
});

async function showPanel(page: import('@playwright/test').Page, panelId: 'path-transform') {
  await openWorkflow(page, 'Geometry', panelId === 'path-transform' ? 'geometry.transform' : panelId);
}

async function openWorkflow(
  page: import('@playwright/test').Page,
  menu: string,
  commandId: string
) {
  await page.getByRole('button', { name: `${menu} menu` }).click();
  await page.locator(`[data-editor-workflow-command="${commandId}"]`).click();
}
