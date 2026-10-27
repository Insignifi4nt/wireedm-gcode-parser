import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/native-sketch-solver';
import { readFile } from 'node:fs/promises';
import type { CadDocument, CadFeature, CadSketchFeature } from '../src/domain/cad/cadDocument';
import { prepareCadTools, callCadTool, cadContext, historyRow } from './cad-tool-helpers';

const base = (id: string) => ({ id, name: id, suppressed: false });
const source = (id: string, x: number): CadSketchFeature => ({ ...base(id), kind: 'sketch', plane: 'XY', offset: 0,
  profiles: [{ id: `${id}_profile`, name: 'Rectangle', construction: false,
    geometry: { kind: 'rectangle', x, y: 0, width: 20, height: 10, cornerRadius: 0 } }] });
const pad = (id: string, sketchId: string): CadFeature => ({ ...base(id), kind: 'extrude', sketchId, distance: 5, symmetric: false, operation: 'new', targetId: null });
const cadDocument = (features: readonly CadFeature[]): CadDocument => ({ format: 'wireedm-cad', schemaVersion: 1, id: 'kernel_browser', name: 'Kernel verification', units: 'mm', parameters: {}, features });

async function openCad(page: Page) {
  await prepareCadTools(page);
  await page.getByRole('button', { name: 'Design in CAD', exact: true }).click();
  await expect(page.getByRole('main', { name: 'Parametric CAD workbench' })).toBeVisible();
}
async function importDocument(page: Page, features: readonly CadFeature[]) {
  const before = await cadContext(page);
  const sourceDocument = cadDocument(features);
  await page.getByRole('button', { name: 'File', exact: true }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: 'Import file', exact: true }).click();
  await (await chooser).setFiles({ name: 'kernel.cad.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(sourceDocument)) });
  await expect.poll(async () => {
    const accepted = await cadContext(page);
    return { ...accepted, freshIdentity: accepted.documentId !== before.documentId && accepted.documentId !== sourceDocument.id };
  }).toMatchObject({ documentId: expect.stringMatching(/^cad_/), freshIdentity: true, name: sourceDocument.name, featureCount: features.length, busy: false, workflowOpen: false });
  return cadContext(page);
}

function binaryStlVolume(bytes: Buffer) {
  let volume = 0;
  for (let index = 0; index < bytes.readUInt32LE(80); index++) {
    const offset = 84 + index * 50 + 12;
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = Array.from({ length: 9 }, (_, coordinate) => bytes.readFloatLE(offset + coordinate * 4));
    volume += (ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)) / 6;
  }
  return Math.abs(volume);
}

test('lazy production WASM worker constructs exact Boolean solids and exports STEP and binary STL', async ({ page }) => {
  const wasmRequests: string[] = [];
  const errors: string[] = [];
  page.on('request', request => { if (/replicad_single.*\.wasm/.test(request.url())) wasmRequests.push(request.url()); });
  page.on('pageerror', error => errors.push(error.message));
  await openCad(page);
  expect(await cadContext(page)).toMatchObject({ featureCount: 0, buildState: 'idle', buildId: null });
  expect(wasmRequests).toEqual([]);
  const imported = await importDocument(page, [source('Sketch_A', 0), pad('Box_A', 'Sketch_A'), source('Sketch_B', 10), pad('Box_B', 'Sketch_B'),
    { ...base('Cut_result'), kind: 'boolean', targetId: 'Box_A', toolId: 'Box_B', operation: 'cut' }]);
  expect(await callCadTool(page, 'cad_build', { expectedVersion: imported.version })).toMatchObject({
    diagnostics: [], totalBodies: 1, bodies: [{ featureId: 'Cut_result', name: 'Cut_result', volumeMm3: expect.closeTo(500, 7), solidCount: 1,
      boundsMm: { min: [0, 0, 0], max: [10, 10, 5] } }] });
  await (await historyRow(page, 'Cut_result')).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Properties', exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'Feature properties' })).toContainText('500 mm³');
  expect(wasmRequests).toHaveLength(1);
  const canvas = page.locator('.cad-viewport canvas');
  await expect(canvas).toBeVisible();
  for (const format of ['STEP', 'STL']) {
    await page.getByRole('button', { name: 'File', exact: true }).click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: `Export ${format}`, exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(`Kernel verification.${format.toLowerCase()}`);
    const saved = await download.path();
    if (!saved) throw new Error('CAD export was not saved by the browser.');
    const bytes = await readFile(saved);
    if (format === 'STEP') {
      const step = bytes.toString('utf8');
      expect(step).toMatch(/^ISO-10303-21;/);
      expect(step.trimEnd()).toMatch(/END-ISO-10303-21;$/);
      expect(step).toContain('MANIFOLD_SOLID_BREP');
      expect(step).toContain("'Cut_result'");
    } else {
      expect(bytes.subarray(0, 80).toString('ascii').replace(/\0+$/, '')).toBe('STL Exported by Open CASCADE Technology [dev.opencascade.org]');
      expect(bytes.readUInt32LE(80)).toBeGreaterThan(0);
      expect(bytes.byteLength).toBe(84 + bytes.readUInt32LE(80) * 50);
      expect(binaryStlVolume(bytes)).toBeCloseTo(500, 7);
    }
  }
  expect(wasmRequests).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('an impossible edge operation retains the exact preceding body and reports the failed feature', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await openCad(page);
  const imported = await importDocument(page, [source('Sketch_A', 0), pad('Box_A', 'Sketch_A'),
    { ...base('Impossible_fillet'), kind: 'fillet', targetId: 'Box_A', radius: 100 }]);
  expect(await callCadTool(page, 'cad_build', { expectedVersion: imported.version })).toMatchObject({
    totalBodies: 1, bodies: [{ featureId: 'Box_A', volumeMm3: expect.closeTo(1000, 7), solidCount: 1 }],
    diagnostics: expect.arrayContaining([{ code: 'rebuild-stopped', featureId: 'Impossible_fillet', message: expect.stringContaining('preceding valid features') }]) });
  await expect.poll(() => cadContext(page)).toMatchObject({ version: imported.version, buildVersion: imported.version, buildState: 'error',
    diagnostics: expect.arrayContaining([{ code: 'rebuild-stopped', featureId: 'Impossible_fillet', message: expect.stringContaining('Rebuild stopped here') }]) });
  const toast = page.locator('[data-status-toast="error"]').filter({ hasText: 'Impossible_fillet' });
  await expect(toast).toContainText('Rebuild stopped here');
  const message = await toast.innerText();
  await toast.click();
  await expect(toast).toHaveCount(0);
  await page.getByRole('button', { name: 'Open notifications', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Notifications and agent activity' }).locator('[data-status-notification-type="error"]').filter({ hasText: 'Impossible_fillet' })).toHaveText(message);
  await page.keyboard.press('Escape');
  const failedFeature = (await historyRow(page, 'Impossible_fillet'));
  await expect(failedFeature).toHaveAttribute('aria-description', /Fillet · Impossible_fillet · .+/);
  await expect(page.getByRole('status').filter({ hasText: 'Feature needs attention' })).toBeVisible();
  await (await historyRow(page, 'Box_A')).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Properties', exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'Feature properties' })).toContainText('1,000 mm³');
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Export STEP', exact: true })).toBeDisabled();
  await expect(page.getByRole('menuitem', { name: 'Export STL', exact: true })).toBeDisabled();
  expect(errors).toEqual([]);
});
