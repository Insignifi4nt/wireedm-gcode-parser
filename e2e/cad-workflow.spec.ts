import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

// Exercise the production tool registrations without a browser-specific WebMCP transport.
// Native WebMCP interoperability is also checked separately in the Codex in-app browser.
async function prepare(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('wireedm.onboarding.dismissed', 'true');
    const tools = new Map<string, { execute(input: unknown): Promise<unknown> }>();
    Object.defineProperty(document, 'modelContext', { configurable: true, value: {
      registerTool(tool: { name: string; execute(input: unknown): Promise<unknown> }, options: { signal: AbortSignal }) {
        tools.set(tool.name, tool);
        options.signal.addEventListener('abort', () => { if (tools.get(tool.name) === tool) tools.delete(tool.name); });
      }
    } });
    Object.defineProperty(document, '__cadTestTools', { value: tools });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Design in CAD' })).toBeEnabled();
}
async function rawCall(page: Page, name: string, input: unknown = {}) {
  return page.evaluate(async ({ name, input }) => {
    const tools = (document as Document & { __cadTestTools: Map<string, { execute(input: unknown): Promise<unknown> }> }).__cadTestTools;
    const tool = tools.get(name);
    if (!tool) throw new Error(`Missing registered tool ${name}`);
    return tool.execute(input);
  }, { name, input });
}
async function call(page: Page, name: string, input: unknown = {}) {
  const result = await rawCall(page, name, input);
  expect(result, `${name}: ${JSON.stringify(result)}`).toMatchObject({ ok: true });
  if (!result || typeof result !== 'object' || !('data' in result) || !result.data || typeof result.data !== 'object') throw new Error('Invalid tool result');
  return result.data;
}
async function context(page: Page) {
  const value = await call(page, 'cad_get_context');
  if (!('version' in value) || typeof value.version !== 'string' || !('documentId' in value) || typeof value.documentId !== 'string') throw new Error('Invalid CAD context');
  return { ...value, version: value.version, documentId: value.documentId };
}
const edits = [
  { kind: 'set-parameter', name: 'width', value: 60 },
  { kind: 'add-feature', feature: { id: 'outline', name: 'Manufacturing outline', kind: 'sketch', suppressed: false, plane: 'XY', offset: 0,
    profiles: [
      { id: 'plate', name: 'Plate', construction: false, role: 'outer', geometry: { kind: 'rectangle', x: 0, y: 0, width: 'width', height: 40, cornerRadius: 3 } },
      { id: 'bore', name: 'Bore', construction: false, role: 'hole', geometry: { kind: 'circle', x: 'width / 2', y: 20, radius: 5 } }
    ] } },
  { kind: 'add-feature', feature: { id: 'pad', name: 'Pad', kind: 'extrude', suppressed: false, sketchId: 'outline', distance: 10, symmetric: false, operation: 'new', targetId: null } }
];

test('agent builds, checks exact volume, exports, reopens and hands analytic geometry to CAM', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await prepare(page);
  const empty = await context(page);
  await call(page, 'cad_create_document', { expectedVersion: empty.version, name: 'Precision plate' });
  const created = await context(page);
  await call(page, 'cad_edit_document', { expectedVersion: created.version, edits });
  const current = await context(page);
  const result = await call(page, 'cad_build', { expectedVersion: current.version });
  const expectedVolume = (60 * 40 - (4 - Math.PI) * 9 - Math.PI * 25) * 10;
  expect(result).toMatchObject({ diagnostics: [], bodies: [{ featureId: 'pad', volumeMm3: expect.closeTo(expectedVolume, 5), boundsMm: { max: [expect.closeTo(60, 8), expect.closeTo(40, 8), expect.closeTo(10, 8)] } }] });
  await expect(page.locator('.cad-statusbar')).toContainText('Ready');
  await expect(page.locator('.cad-viewport canvas')).toBeVisible();
  await call(page, 'cad_set_viewport', { expectedVersion: current.version, command: { kind: 'set-view', view: 'Top' } });
  await expect.poll(() => call(page, 'cad_get_viewport', { expectedVersion: current.version })).toMatchObject({ view: { mode: 'solid', view: 'Top' }, buildVersion: current.version });
  const capture = await call(page, 'cad_capture_preview', { expectedVersion: current.version });
  expect(capture).toMatchObject({ contentSource: 'cad-draft', documentId: current.documentId, draftVersion: current.version, dirty: true, source: '3d', mimeType: 'image/png', sha256: expect.stringMatching(/^[a-f0-9]{64}$/), downloadRequested: false });
  await page.screenshot({ path: 'tmp/cad-workbench.png' });
  await call(page, 'cad_set_viewport', { expectedVersion: current.version, command: { kind: 'edit-sketch', sketchId: 'outline' } });
  await expect.poll(() => call(page, 'cad_get_viewport', { expectedVersion: current.version })).toMatchObject({ view: { mode: 'sketch', available: true } });
  const sketchCapture = await call(page, 'cad_capture_preview', { expectedVersion: current.version });
  expect(sketchCapture).toMatchObject({ contentSource: 'cad-draft', sketchId: 'outline', source: '2d', dirty: true });
  await call(page, 'cad_set_viewport', { expectedVersion: current.version, command: { kind: 'finish-sketch' } });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1440);
  await expect(rawCall(page, 'cad_edit_document', { expectedVersion: created.version, edits: [{ kind: 'rename-document', name: 'Stale' }] })).resolves.toMatchObject({ ok: false, error: { code: 'STALE_STATE' } });
  const downloadPromise = page.waitForEvent('download');
  await call(page, 'cad_export_solid', { expectedVersion: current.version, format: 'step' });
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('Precision plate.step');
  const downloaded = await download.path();
  if (!downloaded) throw new Error('Missing STEP download');
  expect(await readFile(downloaded, 'utf8')).toContain('MANIFOLD_SOLID_BREP');
  await call(page, 'cad_save_document', { expectedVersion: current.version });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Design in CAD' })).toBeEnabled();
  const reloaded = await context(page);
  const library = await call(page, 'cad_list_documents');
  expect(library).toMatchObject({ items: [{ id: current.documentId, name: 'Precision plate', featureCount: 2 }] });
  await call(page, 'cad_open_document', { expectedVersion: reloaded.version, documentId: current.documentId });
  const reopened = await context(page);
  expect(reopened).toMatchObject({ dirty: false, featureCount: 2 });
  const handoff = await call(page, 'cad_send_to_cam', { expectedVersion: reopened.version, sketchId: 'outline' });
  expect(handoff).toMatchObject({ opened: true, sourceDocumentId: current.documentId, sketchId: 'outline' });
  await expect(page.locator('[data-preview-model="upid"]')).toBeVisible();
  const cam = await call(page, 'edm_get_context');
  expect(cam).toMatchObject({ draft: { dirty: false, model: 'upid' } });
  expect(errors).toEqual([]);
});

test('final-solid section preview protects its workflow and creates clean CAM geometry', async ({ page }) => {
  await prepare(page);
  const initial = await context(page);
  await call(page, 'cad_create_document', { expectedVersion: initial.version, name: 'Section plate' });
  const blank = await context(page);
  await call(page, 'cad_edit_document', { expectedVersion: blank.version, edits });
  const current = await context(page);
  await call(page, 'cad_build', { expectedVersion: current.version });
  const request = { bodyId: 'pad', plane: 'XY', offset: 5 };
  const section = await call(page, 'cad_inspect_section', { expectedVersion: current.version, section: request, limit: 2 });
  expect(section).toMatchObject({ bodyId: 'pad', plane: 'XY', offset: 5, contourCount: 2, entities: { items: expect.any(Array), total: 10, nextOffset: 2 } });
  await page.getByRole('button', { name: 'Section for CAM', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Section for CAM' });
  await expect(dialog).toBeVisible();
  expect(await rawCall(page, 'cad_edit_document', { expectedVersion: current.version, edits: [{ kind: 'rename-document', name: 'Interruption' }] })).toMatchObject({ ok: false, error: { code: 'WORKFLOW_OPEN' } });
  await dialog.getByLabel('Plane offset (mm)').fill('5');
  await dialog.getByRole('button', { name: 'Preview section', exact: true }).click();
  await expect(dialog.getByRole('img', { name: 'Exact section preview' })).toBeVisible();
  await expect(dialog.getByRole('status')).toContainText('2 closed contours');
  await dialog.getByRole('button', { name: 'Send section to CAM', exact: true }).click();
  await expect(page.locator('[data-preview-model="upid"]')).toBeVisible();
  const cam = await call(page, 'edm_get_context');
  expect(cam).toMatchObject({ draft: { model: 'upid', dirty: false } });
});

test('human sketch drawing and dimensions share undo and active-workflow protection with agents', async ({ page }) => {
  await prepare(page);
  await page.getByRole('button', { name: 'Design in CAD' }).click();
  await page.getByRole('button', { name: 'Sketch', exact: true }).click();
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  const canvas = page.getByLabel('Sketch drawing canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('No sketch canvas');
  await canvas.click({ position: { x: box.width * 0.35, y: box.height * 0.65 } });
  let current = await context(page);
  expect(current).toMatchObject({ workflowOpen: true });
  expect(await rawCall(page, 'cad_edit_document', { expectedVersion: current.version, edits: [{ kind: 'rename-document', name: 'Interrupt drawing' }] })).toMatchObject({ ok: false, error: { code: 'WORKFLOW_OPEN' } });
  await canvas.click({ position: { x: box.width * 0.6, y: box.height * 0.35 } });
  await page.getByLabel('Width', { exact: false }).fill('50');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  current = await context(page);
  expect(current).toMatchObject({ workflowOpen: false });
  const features = await call(page, 'cad_read_features', { expectedVersion: current.version });
  expect(features).toMatchObject({ items: [{ kind: 'sketch', profiles: [{ geometry: { kind: 'rectangle', width: '50' } }] }] });
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  current = await context(page);
  const undone = await call(page, 'cad_read_features', { expectedVersion: current.version });
  expect(undone).not.toMatchObject({ items: [{ profiles: [{ geometry: { width: '50' } }] }] });
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await page.getByRole('button', { name: 'Finish sketch', exact: true }).click();
  await page.getByRole('button', { name: 'Pad / Pocket', exact: true }).click();
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.locator('.cad-statusbar')).toContainText('Ready', { timeout: 60_000 });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.cad-statusbar')).toContainText('Document saved');
});
