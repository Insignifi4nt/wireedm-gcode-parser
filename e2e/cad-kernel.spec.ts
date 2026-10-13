import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const base = (id: string) => ({ id, name: id, suppressed: false });
const source = (id: string, x: number) => ({ ...base(id), kind: 'sketch', plane: 'XY', offset: 0,
  profiles: [{ id: `${id}_profile`, name: 'Rectangle', role: 'outer', construction: false,
    geometry: { kind: 'rectangle', x, y: 0, width: 20, height: 10, cornerRadius: 0 } }] });
const pad = (id: string, sketchId: string) => ({ ...base(id), kind: 'extrude', sketchId, distance: 5, symmetric: false, operation: 'new', targetId: null });
const document = (features: unknown[]) => ({ format: 'wireedm-cad', schemaVersion: 1, id: 'kernel_browser', name: 'Kernel verification', units: 'mm', parameters: {}, features });

async function openCad(page: Page) {
  await page.addInitScript(() => { localStorage.setItem('wireedm.onboarding.dismissed', 'true'); });
  await page.goto('/');
  await page.getByRole('button', { name: 'Design in CAD', exact: true }).click();
  await expect(page.getByRole('main', { name: 'Parametric CAD workbench' })).toBeVisible();
}
async function importDocument(page: Page, features: unknown[]) {
  await page.locator('.cad-header input[type=file]').setInputFiles({ name: 'kernel.wireedm-cad', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(document(features))) });
}

test('lazy production WASM worker constructs exact Boolean solids and exports STEP and binary STL', async ({ page }) => {
  const wasmRequests: string[] = [];
  const errors: string[] = [];
  page.on('request', request => { if (/replicad_single.*\.wasm/.test(request.url())) wasmRequests.push(request.url()); });
  page.on('pageerror', error => errors.push(error.message));
  await openCad(page);
  expect(wasmRequests).toEqual([]);
  await importDocument(page, [source('Sketch_A', 0), pad('Box_A', 'Sketch_A'), source('Sketch_B', 10), pad('Box_B', 'Sketch_B'),
    { ...base('Cut_result'), kind: 'boolean', targetId: 'Box_A', toolId: 'Box_B', operation: 'cut' }]);
  await expect(page.locator('.cad-statusbar')).toContainText('1 bodies', { timeout: 60_000 });
  await page.locator('.cad-tree-row').filter({ hasText: 'Cut_result' }).click();
  await expect(page.locator('.cad-solid-info')).toContainText('500 mm³');
  expect(wasmRequests).toHaveLength(1);
  const canvas = page.locator('.cad-viewport canvas');
  await expect(canvas).toBeVisible();
  for (const format of ['STEP', 'STL']) {
    await page.getByRole('button', { name: 'File', exact: true }).click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: `Export ${format}`, exact: true }).click();
    const download = await downloadPromise;
    const saved = await download.path();
    if (!saved) throw new Error('CAD export was not saved by the browser.');
    const bytes = await readFile(saved);
    if (format === 'STEP') {
      expect(bytes.toString('utf8')).toContain('ISO-10303-21');
      expect(bytes.toString('utf8')).toContain('MANIFOLD_SOLID_BREP');
      expect(bytes.toString('utf8')).toContain('Cut_result');
    } else {
      expect(bytes.readUInt32LE(80)).toBeGreaterThan(0);
      expect(bytes.byteLength).toBe(84 + bytes.readUInt32LE(80) * 50);
    }
  }
  expect(wasmRequests).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('an impossible edge operation retains the exact preceding body and reports the failed feature', async ({ page }) => {
  await openCad(page);
  await importDocument(page, [source('Sketch_A', 0), pad('Box_A', 'Sketch_A'),
    { ...base('Impossible_fillet'), kind: 'fillet', targetId: 'Box_A', radius: 100 }]);
  await expect(page.locator('.cad-statusbar')).toContainText('1 bodies', { timeout: 60_000 });
  await expect(page.locator('.cad-diagnostics')).toContainText('Rebuild stopped here');
  await page.locator('.cad-tree-row').filter({ hasText: 'Box_A' }).click();
  await expect(page.locator('.cad-solid-info')).toContainText('1,000 mm³');
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Export STEP', exact: true })).toBeDisabled();
});
