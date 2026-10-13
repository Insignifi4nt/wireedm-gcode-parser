import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { CadTopologyDescriptor } from '../src/domain/cad/cadTopology';
import type { CadFeature, CadSketchFeature } from '../src/domain/cad/cadDocument';

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
      { id: 'plate', name: 'Plate', construction: false, geometry: { kind: 'rectangle', x: 0, y: 0, width: 'width', height: 40, cornerRadius: 3 } },
      { id: 'bore', name: 'Bore', construction: false, geometry: { kind: 'circle', x: 'width / 2', y: 20, radius: 5 } }
    ] } },
  { kind: 'add-feature', feature: { id: 'pad', name: 'Pad', kind: 'extrude', suppressed: false, sketchId: 'outline', distance: 10, symmetric: false, operation: 'new', targetId: null } }
];

async function createBox(page: Page) {
  await prepare(page);
  const initial = await context(page);
  await call(page, 'cad_create_document', { expectedVersion: initial.version, name: 'Parametric housing' });
  const created = await context(page);
  await call(page, 'cad_edit_document', { expectedVersion: created.version, edits: [
    { kind: 'set-parameter', name: 'width', value: 20 }, { kind: 'set-parameter', name: 'height', value: 5 },
    { kind: 'add-feature', feature: { id: 'outline', name: 'Footprint', kind: 'sketch', suppressed: false, plane: 'XY', offset: 0,
      profiles: [{ id: 'base', name: 'Base', construction: false, geometry: { kind: 'rectangle', x: 0, y: 0, width: 'width', height: 10, cornerRadius: 0 } }] } },
    { kind: 'add-feature', feature: { id: 'pad', name: 'Pad', kind: 'extrude', suppressed: false, sketchId: 'outline', distance: 'height', symmetric: false, operation: 'new', targetId: null } }
  ] });
  const draft = await context(page);
  const build = await call(page, 'cad_build', { expectedVersion: draft.version });
  expect(build).toMatchObject({ bodies: [{ volumeMm3: expect.closeTo(1000, 7) }] });
  return { draft, buildId: build.buildId };
}

test('human and agent share a parametric circular bolt-hole pattern through exact CAM handoff', async ({ page }) => {
  await prepare(page);
  const initial = await context(page);
  await call(page, 'cad_create_document', { expectedVersion: initial.version, name: 'Four-bolt flange' });
  const blank = await context(page);
  expect(await call(page, 'cad_describe_features', { kind: 'circular-pattern' })).toMatchObject({
    schema: { required: expect.arrayContaining(['sourceId', 'count', 'axis', 'center', 'angle']) }
  });
  const sketch = (id: string, name: string, x: number, radius: number): CadSketchFeature => ({
    id, name, kind: 'sketch', plane: 'XY', offset: 0, suppressed: false,
    profiles: [{ id: `${id}_circle`, name: 'Circle', construction: false, geometry: { kind: 'circle', x, y: 0, radius } }]
  });
  const pad = (id: string, name: string, sketchId: string): CadFeature => ({
    id, name, kind: 'extrude', suppressed: false, sketchId, distance: 'thickness', symmetric: false, operation: 'new', targetId: null
  });
  await call(page, 'cad_edit_document', { expectedVersion: blank.version, edits: [
    { kind: 'set-parameter', name: 'thickness', value: 8 }, { kind: 'set-parameter', name: 'sweep', value: 360 },
    ...[sketch('flange_outline', 'Flange outline', 0, 30), pad('flange_pad', 'Flange', 'flange_outline'),
      sketch('cutter_outline', 'Bolt cutter outline', 20, 3), pad('cutter_pad', 'Bolt cutter', 'cutter_outline')]
      .map(feature => ({ kind: 'add-feature', feature }))
  ] });
  const seeded = await context(page);
  expect(await call(page, 'cad_build', { expectedVersion: seeded.version })).toMatchObject({ diagnostics: [], totalBodies: 2 });
  await call(page, 'cad_set_viewport', { expectedVersion: seeded.version, command: { kind: 'select-feature', featureId: 'cutter_pad' } });
  await page.getByRole('button', { name: 'Pattern', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Circular pattern', exact: true }).click();
  await expect(page.getByLabel('Instances, including original')).toHaveValue('4');
  await page.getByLabel('Angular extent', { exact: false }).fill('sweep');
  expect(await rawCall(page, 'cad_edit_document', { expectedVersion: seeded.version,
    edits: [{ kind: 'rename-document', name: 'Must remain blocked' }] })).toMatchObject({ ok: false, error: { code: 'WORKFLOW_OPEN' } });
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  const patterned = await context(page);
  const definitions = await call(page, 'cad_read_features', { expectedVersion: patterned.version });
  const pattern = (definitions as { items: CadFeature[] }).items.find(feature => feature.kind === 'circular-pattern');
  expect(pattern).toMatchObject({ sourceId: 'cutter_pad', count: 4, axis: 'z', center: [0, 0, 0], angle: 'sweep' });
  if (!pattern) throw new Error('Missing applied circular pattern');
  await call(page, 'cad_edit_document', { expectedVersion: patterned.version, edits: [{ kind: 'add-feature', feature: {
    id: 'drilled_flange', name: 'Drilled flange', kind: 'boolean', suppressed: false,
    operation: 'cut', targetId: 'flange_pad', toolId: pattern.id
  } }] });
  const drilled = await context(page);
  expect(await call(page, 'cad_build', { expectedVersion: drilled.version })).toMatchObject({ diagnostics: [], totalBodies: 1,
    bodies: [{ featureId: 'drilled_flange', volumeMm3: expect.closeTo(6912 * Math.PI, 6),
      boundsMm: { min: [expect.closeTo(-30, 5), expect.closeTo(-30, 5), expect.closeTo(0, 5)], max: [expect.closeTo(30, 5), expect.closeTo(30, 5), expect.closeTo(8, 5)] } }] });
  const section = { bodyId: 'drilled_flange', plane: 'XY', offset: 'thickness / 2' };
  expect(await call(page, 'cad_inspect_section', { expectedVersion: drilled.version, section })).toMatchObject({ contourCount: 5 });
  await call(page, 'cad_set_viewport', { expectedVersion: drilled.version, command: { kind: 'select-feature', featureId: 'drilled_flange' } });
  await page.getByRole('button', { name: 'Fit model', exact: true }).click();
  expect(await call(page, 'cad_capture_preview', { expectedVersion: drilled.version })).toMatchObject({ source: '3d', draftVersion: drilled.version });
  await page.screenshot({ path: 'tmp/cad-circular-flange.png' });
  await call(page, 'cad_save_document', { expectedVersion: drilled.version });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Design in CAD' })).toBeEnabled();
  const reloaded = await context(page);
  await call(page, 'cad_open_document', { expectedVersion: reloaded.version, documentId: drilled.documentId });
  const reopened = await context(page);
  expect(await call(page, 'cad_get_feature', { expectedVersion: reopened.version, featureId: pattern.id })).toMatchObject({ feature: pattern });
  expect(await call(page, 'cad_send_section_to_cam', { expectedVersion: reopened.version, section })).toMatchObject({
    opened: true, sourceDocumentId: drilled.documentId, section: { contourCount: 5, offset: 4 }
  });
  await expect(page.locator('[data-preview-model="upid"]')).toBeVisible();
});

test('agent selects exact top edges and chamfers only that rim', async ({ page }) => {
  const { draft, buildId } = await createBox(page);
  const topology = await call(page, 'cad_inspect_topology', { expectedVersion: draft.version, expectedBuildId: buildId, bodyId: 'pad', kind: 'edge', limit: 50 });
  const descriptors = (topology as { descriptors: CadTopologyDescriptor[] }).descriptors;
  const rim = descriptors.filter(edge => edge.kind === 'edge' && edge.curveType === 'line' && Math.abs(edge.start[2] - 5) < 1e-7 && Math.abs(edge.end[2] - 5) < 1e-7);
  expect(rim).toHaveLength(4);
  const picks = rim.map(edge => ({ kind: 'edge', key: edge.key }));
  const resolved = await call(page, 'cad_resolve_topology', { expectedVersion: draft.version, expectedBuildId: buildId, bodyId: 'pad', purpose: 'chamfer', picks });
  expect(resolved).toMatchObject({ purpose: 'chamfer', selection: { expectedCount: 4 } });
  await call(page, 'cad_set_viewport', { expectedVersion: draft.version, command: { kind: 'select-topology', additive: false,
    selection: { documentVersion: draft.version, buildId, bodyId: 'pad', picks } } });
  await expect.poll(() => call(page, 'cad_get_viewport', { expectedVersion: draft.version })).toMatchObject({ topologySelection: { bodyId: 'pad', picks } });
  const capture = await call(page, 'cad_capture_preview', { expectedVersion: draft.version });
  expect(capture).toMatchObject({ source: '3d', viewState: { topologySelection: { picks } } });
  await call(page, 'cad_edit_document', { expectedVersion: draft.version, edits: [{ kind: 'add-feature', feature: {
    id: 'chamfer', name: 'Top rim', kind: 'chamfer', suppressed: false, targetId: 'pad', radius: 1, selection: resolved.selection
  } }] });
  const changed = await context(page);
  const built = await call(page, 'cad_build', { expectedVersion: changed.version });
  expect(built).toMatchObject({ diagnostics: [], bodies: [{ featureId: 'chamfer', volumeMm3: expect.closeTo(1000 - 30 + 4 / 3, 6) }] });
  await expect(rawCall(page, 'cad_inspect_topology', { expectedVersion: changed.version, expectedBuildId: buildId, bodyId: 'chamfer', kind: 'edge' })).resolves.toMatchObject({ ok: false, error: { code: 'STALE_BUILD' } });
  const after = await call(page, 'cad_inspect_topology', { expectedVersion: changed.version, expectedBuildId: built.buildId, bodyId: 'chamfer', kind: 'edge', limit: 50 });
  const bottom = (after as { descriptors: CadTopologyDescriptor[] }).descriptors.filter(edge => edge.kind === 'edge' && edge.curveType === 'line' && Math.abs(edge.start[2]) < 1e-7 && Math.abs(edge.end[2]) < 1e-7);
  expect(bottom).toHaveLength(4);
});

test('one compact header and real face picking create an inward shell', async ({ page }) => {
  const { draft } = await createBox(page);
  await expect(page.locator('[data-app-header] .cad-header')).toHaveCount(1);
  await expect(page.locator('.cad-workbench .cad-header')).toHaveCount(0);
  await page.getByLabel('Named view').selectOption('Top');
  await page.getByRole('button', { name: 'Fit model', exact: true }).click();
  await page.getByRole('button', { name: 'Face', exact: true }).click();
  const canvas = page.locator('.cad-viewport canvas');
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('Missing solid canvas');
  expect(bounds.height).toBeGreaterThan(650);
  await canvas.click({ position: { x: bounds.width / 2, y: bounds.height / 2 } });
  await expect.poll(() => call(page, 'cad_get_viewport', { expectedVersion: draft.version })).toMatchObject({ pickMode: 'face', topologySelection: { bodyId: 'pad', picks: [{ kind: 'face' }] } });
  await page.getByRole('button', { name: 'Shell', exact: true }).click();
  await expect(page.getByLabel('Wall thickness', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  const changed = await context(page);
  expect(await call(page, 'cad_build', { expectedVersion: changed.version })).toMatchObject({ diagnostics: [], bodies: [{ volumeMm3: expect.closeTo(424, 7) }] });
});

test('CAD panel resizing preserves pending dimensions and restores preferred widths', async ({ page }) => {
  const { draft } = await createBox(page);
  await page.locator('.cad-tree-row').filter({ hasText: 'Pad' }).click();
  const length = page.getByLabel('Length', { exact: false });
  await length.fill('height + 2');
  const treeHandle = page.getByRole('separator', { name: 'Resize CAD model tree' });
  const propertiesHandle = page.getByRole('separator', { name: 'Resize CAD properties' });
  await treeHandle.press('End');
  await propertiesHandle.press('End');
  const treeWidth = await treeHandle.getAttribute('aria-valuenow');
  const propertiesWidth = await propertiesHandle.getAttribute('aria-valuenow');
  if (!treeWidth || !propertiesWidth) throw new Error('Missing accessible panel widths');
  expect(await context(page)).toMatchObject({ version: draft.version, workflowOpen: true });
  await page.setViewportSize({ width: 1024, height: 900 });
  await expect(length).toHaveValue('height + 2');
  await expect.poll(async () => (await page.locator('.cad-viewport canvas').boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(240);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1024);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(treeHandle).toHaveAttribute('aria-valuenow', treeWidth);
  await expect(propertiesHandle).toHaveAttribute('aria-valuenow', propertiesWidth);
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  const changed = await context(page);
  expect(await call(page, 'cad_build', { expectedVersion: changed.version })).toMatchObject({ diagnostics: [], bodies: [{ volumeMm3: expect.closeTo(1400, 6) }] });
  await call(page, 'cad_set_viewport', { expectedVersion: changed.version, command: { kind: 'select-feature', featureId: null } });
  await expect(propertiesHandle).not.toBeVisible();
  await call(page, 'cad_set_viewport', { expectedVersion: changed.version, command: { kind: 'select-feature', featureId: 'pad' } });
  await expect(propertiesHandle).toHaveAttribute('aria-valuenow', propertiesWidth);
});

test('STEP and STL exports import as standalone solids with preserved originals', async ({ page }) => {
  test.setTimeout(120_000);
  const { draft } = await createBox(page);
  await call(page, 'cad_save_document', { expectedVersion: draft.version });
  for (const format of ['step', 'stl'] as const) {
    const before = await context(page);
    const downloadPromise = page.waitForEvent('download');
    await call(page, 'cad_export_solid', { expectedVersion: before.version, format });
    const download = await downloadPromise; const path = await download.path();
    if (!path) throw new Error('Missing geometry download');
    const bytes = await readFile(path);
    const source = format === 'step'
      ? { format, fileName: 'exchange.step', encoding: 'utf8', data: bytes.toString('utf8') }
      : { format, fileName: 'exchange.stl', encoding: 'base64', data: bytes.toString('base64'), units: 'mm' };
    expect(await call(page, 'cad_import_solid', { expectedVersion: before.version, source })).toMatchObject({ imported: true, format, sourceBytes: bytes.length, volume: expect.closeTo(1000, 6) });
    const imported = await context(page);
    expect(imported.documentId).not.toBe(before.documentId);
    expect(await call(page, 'cad_build', { expectedVersion: imported.version })).toMatchObject({ diagnostics: [], bodies: [{ volumeMm3: expect.closeTo(1000, 6) }] });
    const features = await call(page, 'cad_read_features', { expectedVersion: imported.version });
    expect(features).toMatchObject({ items: [{ kind: 'imported', source }] });
    await call(page, 'cad_save_document', { expectedVersion: imported.version });
    await page.reload();
    await expect(page.getByRole('button', { name: 'Design in CAD' })).toBeEnabled();
    const reloaded = await context(page);
    await call(page, 'cad_open_document', { expectedVersion: reloaded.version, documentId: imported.documentId });
    const opened = await context(page);
    expect(await call(page, 'cad_build', { expectedVersion: opened.version })).toMatchObject({ diagnostics: [], bodies: [{ volumeMm3: expect.closeTo(1000, 6) }] });
  }
});

test('visible STL import reviews source units before changing the draft', async ({ page }) => {
  const { draft } = await createBox(page);
  await call(page, 'cad_save_document', { expectedVersion: draft.version });
  const downloadPromise = page.waitForEvent('download');
  await call(page, 'cad_export_solid', { expectedVersion: draft.version, format: 'stl' });
  const download = await downloadPromise; const path = await download.path();
  if (!path) throw new Error('Missing STL download');
  await page.locator('.cad-header input[type=file]').setInputFiles({ name: 'source.stl', mimeType: 'model/stl', buffer: await readFile(path) });
  const pending = page.getByRole('dialog', { name: 'Import CAD file' });
  await expect(pending).toBeVisible();
  expect(await context(page)).toMatchObject({ documentId: draft.documentId, workflowOpen: true });
  await pending.getByLabel('Source units').selectOption('inch');
  await pending.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(pending).not.toBeVisible();
  const imported = await context(page);
  expect(await call(page, 'cad_build', { expectedVersion: imported.version })).toMatchObject({ diagnostics: [], bodies: [{ volumeMm3: expect.closeTo(1000 * 25.4 ** 3, 3) }] });
});

test('DXF exchange preserves exact rounded contours and reconstructs a standalone editable part', async ({ page }) => {
  await prepare(page);
  const initial = await context(page);
  await call(page, 'cad_create_document', { expectedVersion: initial.version, name: 'Drawing exchange' });
  const empty = await context(page);
  await call(page, 'cad_edit_document', { expectedVersion: empty.version, edits });
  const original = await context(page);
  await call(page, 'cad_save_document', { expectedVersion: original.version });
  const downloadPromise = page.waitForEvent('download');
  await call(page, 'cad_export_dxf', { expectedVersion: original.version, sketchId: 'outline' });
  const path = await (await downloadPromise).path();
  if (!path) throw new Error('Missing DXF download');
  const text = await readFile(path, 'utf8');
  const source = { format: 'dxf', fileName: 'rounded-plate.dxf', text };
  const imported = await call(page, 'cad_import_dxf', { expectedVersion: original.version, source });
  expect(imported).toMatchObject({ imported: true, contourCount: 2, scaleToMillimeters: 1 });
  if (typeof imported.sketchId !== 'string') throw new Error('Missing imported sketch ID');
  const draft = await context(page);
  expect(draft.documentId).not.toBe(original.documentId);
  const definitions = await call(page, 'cad_read_features', { expectedVersion: draft.version });
  expect(definitions).toMatchObject({ items: [{ kind: 'sketch', plane: 'XY', source,
    profiles: expect.arrayContaining([{ id: expect.any(String), name: expect.any(String), construction: false, geometry: { kind: 'path', segments: expect.any(Array) } }]) }] });
  await call(page, 'cad_set_viewport', { expectedVersion: draft.version, command: { kind: 'edit-sketch', sketchId: imported.sketchId } });
  await expect(page.getByLabel('Sketch drawing canvas')).toBeVisible();
  await call(page, 'cad_set_viewport', { expectedVersion: draft.version, command: { kind: 'finish-sketch' } });
  await call(page, 'cad_edit_document', { expectedVersion: draft.version, edits: [{ kind: 'add-feature', feature: {
    id: 'import_pad', name: 'Imported outline pad', kind: 'extrude', suppressed: false, sketchId: imported.sketchId,
    distance: 10, symmetric: false, operation: 'new', targetId: null
  } }] });
  const solid = await context(page);
  const expectedVolume = (60 * 40 - (4 - Math.PI) * 9 - Math.PI * 25) * 10;
  expect(await call(page, 'cad_build', { expectedVersion: solid.version })).toMatchObject({ diagnostics: [], bodies: [{ volumeMm3: expect.closeTo(expectedVolume, 5) }] });
  await call(page, 'cad_save_document', { expectedVersion: solid.version });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Design in CAD' })).toBeEnabled();
  const reloaded = await context(page);
  await call(page, 'cad_open_document', { expectedVersion: reloaded.version, documentId: solid.documentId });
  const opened = await context(page);
  expect(await call(page, 'cad_get_feature', { expectedVersion: opened.version, featureId: imported.sketchId })).toMatchObject({ feature: { source } });
  expect(await call(page, 'cad_build', { expectedVersion: opened.version })).toMatchObject({ diagnostics: [], bodies: [{ volumeMm3: expect.closeTo(expectedVolume, 5) }] });
});

test('an imported path is selected by its interior and edited atomically through segment fields', async ({ page }) => {
  const { draft } = await createBox(page);
  await call(page, 'cad_save_document', { expectedVersion: draft.version });
  const download = page.waitForEvent('download');
  await call(page, 'cad_export_dxf', { expectedVersion: draft.version, sketchId: 'outline' });
  const path = await (await download).path();
  if (!path) throw new Error('Missing DXF download');
  const source = { format: 'dxf', fileName: 'editable-footprint.dxf', text: await readFile(path, 'utf8') };
  const imported = await call(page, 'cad_import_dxf', { expectedVersion: draft.version, source });
  if (typeof imported.sketchId !== 'string') throw new Error('Missing imported sketch ID');
  const before = await context(page);
  await call(page, 'cad_edit_document', { expectedVersion: before.version, edits: [{ kind: 'set-parameter', name: 'tipX', value: 30 }] });
  const current = await context(page);
  const result = await call(page, 'cad_get_feature', { expectedVersion: current.version, featureId: imported.sketchId });
  expect(result).toMatchObject({ feature: { kind: 'sketch', source } });
  const feature = result.feature as CadSketchFeature;
  const profile = feature.profiles[0];
  if (profile.geometry.kind !== 'path') throw new Error('Expected an exact imported path');
  const segments = profile.geometry.segments;
  const segmentIndex = segments.findIndex(segment => segment.kind === 'line' && segment.end[0] === 20 && segment.end[1] === 0);
  if (segmentIndex < 0) throw new Error('Expected the lower right vertex');
  await call(page, 'cad_set_viewport', { expectedVersion: current.version, command: { kind: 'edit-sketch', sketchId: imported.sketchId } });
  await page.getByRole('button', { name: 'Fit sketch', exact: true }).click();
  // A genuine pointer click inside the shape must select it even though the
  // drawing uses transparent fills. Read only the visible SVG view transform.
  const point = await page.getByLabel('Sketch drawing canvas').evaluate(element => {
    const canvas = element as SVGSVGElement;
    const rect = canvas.getBoundingClientRect(); const view = canvas.viewBox.baseVal;
    return { x: rect.x + (10 - view.x) / view.width * rect.width, y: rect.y + (-5 - view.y) / view.height * rect.height };
  });
  await page.mouse.click(point.x, point.y);
  await expect(page.getByLabel('Path segment', { exact: true })).toBeVisible();
  await page.getByLabel('Path segment', { exact: true }).fill(String(segmentIndex + 1));
  await page.getByLabel('End X', { exact: false }).fill('tipX');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.locator('.cad-property-form [role="alert"]')).toContainText('continuous and closed');
  expect(await context(page)).toMatchObject({ version: current.version, workflowOpen: true });
  await page.getByLabel('Path segment', { exact: true }).fill(String((segmentIndex + 1) % segments.length + 1));
  await page.getByLabel('Start X', { exact: false }).fill('tipX');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.locator('.cad-property-form [role="alert"]')).not.toBeVisible();
  const changed = await context(page);
  expect(changed.version).not.toBe(current.version); expect(changed.workflowOpen).toBe(false);
  expect(await call(page, 'cad_get_feature', { expectedVersion: changed.version, featureId: imported.sketchId })).toMatchObject({ feature: { source } });
  expect(await call(page, 'cad_measure_sketch', { expectedVersion: changed.version, sketchId: imported.sketchId })).toMatchObject({ materialAreaMm2: expect.closeTo(250, 6) });
  await page.screenshot({ path: 'tmp/cad-path-editor.png' });
  await page.getByRole('button', { name: 'Finish sketch', exact: true }).click();
  await call(page, 'cad_edit_document', { expectedVersion: changed.version, edits: [{ kind: 'add-feature', feature: {
    id: 'edited_pad', name: 'Edited footprint pad', kind: 'extrude', suppressed: false, sketchId: imported.sketchId,
    distance: 5, symmetric: false, operation: 'new', targetId: null
  } }] });
  const solid = await context(page);
  expect(await call(page, 'cad_build', { expectedVersion: solid.version })).toMatchObject({ diagnostics: [], bodies: [{ volumeMm3: expect.closeTo(1250, 6) }] });
});

test('agent hollows one planar face and carries a parameterized wall section into CAM', async ({ page }) => {
  const { draft, buildId } = await createBox(page);
  const inspected = await call(page, 'cad_inspect_topology', { expectedVersion: draft.version, expectedBuildId: buildId, bodyId: 'pad', kind: 'face', limit: 50 });
  const top = (inspected as { descriptors: CadTopologyDescriptor[] }).descriptors.filter(face => face.kind === 'face' && face.surfaceType === 'plane' && face.normal[2] > .999 && Math.abs(face.offset - 5) < 1e-7);
  expect(top).toHaveLength(1);
  const resolved = await call(page, 'cad_resolve_topology', { expectedVersion: draft.version, expectedBuildId: buildId, bodyId: 'pad', purpose: 'shell', picks: [{ kind: 'face', key: top[0].key }] });
  expect(resolved).toMatchObject({ purpose: 'shell', opening: { expectedCount: 1 } });
  const shell = { id: 'shell', name: 'Housing walls', kind: 'shell', suppressed: false, targetId: 'pad', thickness: 1,
    opening: { kind: 'faces', expectedCount: 1, predicates: [{ kind: 'plane', normal: [0, 0, 1], offset: 'height' }] } };
  await call(page, 'cad_edit_document', { expectedVersion: draft.version, edits: [{ kind: 'add-feature', feature: shell }] });
  const hollow = await context(page);
  expect(await call(page, 'cad_build', { expectedVersion: hollow.version })).toMatchObject({ diagnostics: [], bodies: [{ featureId: 'shell', volumeMm3: expect.closeTo(424, 7) }] });
  await call(page, 'cad_edit_document', { expectedVersion: hollow.version, edits: [{ kind: 'set-parameter', name: 'width', value: 24 }, { kind: 'set-parameter', name: 'height', value: 8 }] });
  const resized = await context(page);
  expect(await call(page, 'cad_build', { expectedVersion: resized.version })).toMatchObject({ diagnostics: [], bodies: [{ featureId: 'shell', volumeMm3: expect.closeTo(688, 7) }] });
  const section = { bodyId: 'shell', plane: 'XY', offset: 'height / 2' };
  expect(await call(page, 'cad_inspect_section', { expectedVersion: resized.version, section })).toMatchObject({ contourCount: 2, entities: { total: 8 } });
  expect(await call(page, 'cad_send_section_to_cam', { expectedVersion: resized.version, section })).toMatchObject({ opened: true, section: { contourCount: 2, offset: 4 } });
  await expect(page.locator('[data-preview-model="upid"]')).toBeVisible();
});

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
  await page.getByRole('button', { name: 'File', exact: true }).click();
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
  await page.getByLabel('Width', { exact: false }).fill('53');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  current = await context(page);
  expect(current).toMatchObject({ workflowOpen: false });
  const features = await call(page, 'cad_read_features', { expectedVersion: current.version });
  expect(features).toMatchObject({ items: [{ kind: 'sketch', profiles: [{ geometry: { kind: 'rectangle', width: '53' } }] }] });
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  current = await context(page);
  const undone = await call(page, 'cad_read_features', { expectedVersion: current.version });
  expect(undone).not.toMatchObject({ items: [{ profiles: [{ geometry: { width: '53' } }] }] });
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await page.getByRole('button', { name: 'Finish sketch', exact: true }).click();
  await page.getByRole('button', { name: 'Pad / Pocket', exact: true }).click();
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.locator('.cad-statusbar')).toContainText('Ready', { timeout: 60_000 });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => context(page)).toMatchObject({ dirty: false, savedVersion: expect.any(String) });
});
