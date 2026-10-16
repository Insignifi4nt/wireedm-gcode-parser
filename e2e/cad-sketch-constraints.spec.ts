import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { prepareCadTools, callCadTool as call, rawCadToolCall as rawCall, cadContext as context } from './cad-tool-helpers';

test('previews and applies a linked size across legacy and solved sketch geometry, with cancel and undo', async ({ page }) => {
  await prepareCadTools(page); await call(page, 'cad_open_workspace');
  await call(page, 'cad_edit_document', { expectedVersion: (await context(page)).version, edits: [
    { kind: 'set-parameter', name: 'width', value: 20 },
    { kind: 'add-feature', feature: { id: 'outline', kind: 'sketch', name: 'Linked geometry', suppressed: false, plane: 'XY', offset: 0,
      profiles: [{ id: 'plate', name: 'Plate', construction: false, constraints: [{ id: 'width-dimension', kind: 'dimension', quantity: 'width' }],
        geometry: { kind: 'rectangle', x: 40, y: 0, width: ' width ', height: 5, cornerRadius: 0 } }],
      graph: { points: [{ id: 'a', position: ['0', '0'] }, { id: 'b', position: [20, 0] }],
        entities: [{ id: 'ab', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' }],
        relations: [{ id: 'horizontal', kind: 'horizontal', pointIds: ['a', 'b'] }, { id: 'length', kind: 'distance', pointIds: ['a', 'b'], value: 'width' }] } } }
  ] });
  const initial = await context(page);
  await expect.poll(() => rawCall(page, 'cad_get_viewport', { expectedVersion: initial.version }))
    .toMatchObject({ ok: true, data: { view: { available: true, referenceVersion: initial.version } } });
  await call(page, 'cad_set_viewport', { expectedVersion: initial.version, command: { kind: 'edit-sketch', sketchId: 'outline' } });
  await call(page, 'cad_set_viewport', { expectedVersion: initial.version, command: { kind: 'select-profile', profileId: 'plate' } });
  const length = () => page.locator('[data-cad-sketch-entity="ab"] line').evaluate(line => Number(line.getAttribute('x2')) - Number(line.getAttribute('x1')));
  await expect.poll(length).toBeCloseTo(20, 9);
  await page.getByRole('button', { name: 'Configure Width dimension', exact: true }).click();
  await page.getByRole('textbox', { name: 'Dimension value', exact: true }).fill('30');
  await expect.poll(length).toBeCloseTo(30, 9);
  await expect(page.getByLabel('Sketch measurements').locator('dd').first()).toHaveText('150 mm²');
  expect(await context(page)).toMatchObject({ version: initial.version, workflowOpen: true });
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect.poll(length).toBeCloseTo(20, 9); expect((await context(page)).version).toBe(initial.version);
  await page.getByRole('button', { name: 'Configure Width dimension', exact: true }).click();
  await page.getByRole('textbox', { name: 'Dimension value', exact: true }).fill('30');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect.poll(() => context(page)).toMatchObject({ workflowOpen: false });
  const current = await context(page); expect(current.version).not.toBe(initial.version);
  await expect.poll(length).toBeCloseTo(30, 9);
  const accepted = await call(page, 'cad_get_feature', { expectedVersion: current.version, featureId: 'outline' });
  expect(accepted.feature.profiles[0].geometry.width).toBe(' width '); expect(accepted.feature.graph.points[1].position[0]).toBeCloseTo(30, 9);
  await page.keyboard.press('Control+z'); await expect.poll(length).toBeCloseTo(20, 9);
});

test('solves a saved entity sketch through WebMCP, rejects conflicts and exports its exact extrusion', async ({ page }) => {
  const nativeRequests: string[] = [];
  page.on('request', request => { if (request.url().endsWith('.wasm')) nativeRequests.push(request.url()); });
  await prepareCadTools(page);
  await call(page, 'cad_open_workspace');
  const initial = await context(page);
  expect(nativeRequests.some(url => url.includes('planegcs'))).toBe(false);
  await call(page, 'cad_edit_document', { expectedVersion: initial.version, edits: [
    { kind: 'set-parameter', name: 'width', value: 20 },
    { kind: 'add-feature', feature: { kind: 'sketch', id: 'outline', name: 'Constrained outline', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: {
      points: [{ id: 'a', position: ['0', '0'] }, { id: 'b', position: [20, 0] }, { id: 'c', position: [20, 10] }, { id: 'd', position: [0, 10] }],
      entities: [
        { id: 'ab', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' },
        { id: 'bc', kind: 'line', construction: false, startPointId: 'b', endPointId: 'c' },
        { id: 'cd', kind: 'line', construction: false, startPointId: 'c', endPointId: 'd' },
        { id: 'da', kind: 'line', construction: false, startPointId: 'd', endPointId: 'a' }
      ], relations: [
        { id: 'h1', kind: 'horizontal', pointIds: ['a', 'b'] }, { id: 'v1', kind: 'vertical', pointIds: ['b', 'c'] },
        { id: 'h2', kind: 'horizontal', pointIds: ['c', 'd'] }, { id: 'v2', kind: 'vertical', pointIds: ['d', 'a'] },
        { id: 'width', kind: 'distance', pointIds: ['a', 'b'], value: ' width ' }, { id: 'height', kind: 'distance', pointIds: ['a', 'd'], value: 10 }
      ]
    } } }
  ] });
  let current = await context(page);
  await call(page, 'cad_edit_document', { expectedVersion: current.version, edits: [{ kind: 'set-parameter', name: 'width', value: 30 }] });
  current = await context(page);
  const accepted = await call(page, 'cad_get_feature', { expectedVersion: current.version, featureId: 'outline' });
  expect(accepted.feature.graph.points[0].position).toEqual(['0', '0']);
  expect(accepted.feature.graph.points[1].position[0]).toBeCloseTo(30, 9);
  expect(accepted.feature.graph.points[2].position[0]).toBeCloseTo(30, 9);
  expect(accepted.feature.graph.relations[4].value).toBe(' width ');
  const conflict = await rawCall(page, 'cad_edit_document', { expectedVersion: current.version, edits: [
    { kind: 'set-sketch-relation', sketchId: 'outline', relation: { id: 'conflict', kind: 'distance', pointIds: ['a', 'b'], value: 10 } }
  ] });
  expect(conflict.ok).toBe(false); expect((await context(page)).version).toBe(current.version);
  expect(nativeRequests.filter(url => url.includes('planegcs'))).toHaveLength(1);
  expect(nativeRequests.some(url => url.includes('replicad_single') || url.includes('occt-import-js'))).toBe(false);
  await call(page, 'cad_edit_document', { expectedVersion: current.version, edits: [{ kind: 'add-feature', feature: {
    id: 'pad', kind: 'extrude', name: 'Plate', suppressed: false, sketchId: 'outline', distance: 5, symmetric: false, operation: 'new', targetId: null
  } }] });
  current = await context(page);
  const built = await call(page, 'cad_build', { expectedVersion: current.version });
  expect(built.diagnostics).toEqual([]);
  expect(built.bodies[0].volumeMm3).toBeCloseTo(1500, 7);
  const downloadPromise = page.waitForEvent('download');
  await call(page, 'cad_export_solid', { expectedVersion: current.version, format: 'step' });
  const download = await downloadPromise, path = await download.path();
  if (!path) throw new Error('STEP download is missing.');
  expect((await readFile(path, 'utf8')).startsWith('ISO-10303-21;')).toBe(true);
  await call(page, 'cad_save_document', { expectedVersion: current.version });
  await page.reload();
  await expect(page.getByRole('main', { name: 'Parametric CAD workbench' })).toBeVisible();
  const reopened = await context(page);
  expect(reopened).toMatchObject({ documentId: current.documentId, dirty: false });
  expect((await call(page, 'cad_get_feature', { expectedVersion: reopened.version, featureId: 'outline' })).feature).toEqual(accepted.feature);
});
