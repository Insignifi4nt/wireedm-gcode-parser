import { expect, test } from './fixtures/native-sketch-solver';
import type { CadSketchFeature } from '../src/domain/cad/cadDocument';
import { prepareCadTools, callCadTool as call, rawCadToolCall as raw, cadContext as context, historyRow } from './cad-tool-helpers';

test('extends an arc to its finite endpoint, repairs the larger material union and saves the same human and agent part', async ({ page }) => {
  await prepareCadTools(page); await call(page, 'cad_open_workspace');
  const sketch: CadSketchFeature = { id: 'outline', kind: 'sketch', name: 'Arc segment', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: {
    points: [{ id: 'center', position: [' 0.00 ', '0'] }, { id: 'a', position: ['10', '0'] }, { id: 'b', position: [0, 10] }, { id: 'c', position: [-6, 8] }],
    entities: [{ id: 'rim', kind: 'arc', centerPointId: 'center', startPointId: 'a', endPointId: 'b', direction: 'ccw', construction: false },
      { id: 'old-chord', kind: 'line', startPointId: 'b', endPointId: 'a', construction: false },
      { id: 'new-chord', kind: 'line', startPointId: 'c', endPointId: 'a', construction: false }], relations: []
  } };
  await call(page, 'cad_edit_document', { expectedVersion: (await context(page)).version, edits: [{ kind: 'add-feature', feature: sketch }] });
  let current = await context(page);
  const pack = async (cellIds: number[], proposal?: unknown) => {
    let text = '', offset = 0;
    for (;;) {
      const chunk = await call(page, 'cad_read_sketch_region_reference', { expectedVersion: current.version, sketchId: sketch.id, cellIds,
        ...(proposal ? { proposal } : {}), offset, length: 4096 });
      text += chunk.text; if (chunk.nextOffset === null) return JSON.parse(text);
      expect(chunk.nextOffset).toBeGreaterThan(offset); offset = chunk.nextOffset;
    }
  };
  const originalAreas = await call(page, 'cad_inspect_sketch_regions', { expectedVersion: current.version, sketchId: sketch.id, mode: 'graph-cells' });
  expect(originalAreas.items).toHaveLength(1);
  const pad = { id: 'pad', kind: 'extrude', name: 'Segment plate', suppressed: false, sketchId: sketch.id,
    regionSelection: await pack(originalAreas.items.map((area: { cellId: number }) => area.cellId)), distance: ' 5e0 ', symmetric: false, operation: 'new', targetId: null };
  await call(page, 'cad_edit_document', { expectedVersion: current.version, edits: [{ kind: 'add-feature', feature: pad }] }); current = await context(page);
  expect((await call(page, 'cad_build', { expectedVersion: current.version })).bodies[0].volumeMm3).toBeCloseTo(250 * (Math.PI / 2 - 1), 7);
  const originalVersion = current.version;
  const openExtend = async () => {
    await (await historyRow(page, 'Arc segment')).dblclick();
    await page.locator('[data-cad-sketch-entity="rim"]').press('Shift+F10');
    const extend = page.getByRole('menuitem', { name: 'Extend end', exact: true }); await expect(extend).toBeEnabled(); await extend.focus();
    await expect(page.getByLabel('Extend preview', { exact: true }).locator('path.is-added')).toHaveCount(1);
    await expect(page.locator('[data-cad-sketch-extend-point]')).toHaveAttribute('data-cad-sketch-extend-point', 'c'); await extend.click();
  };
  await openExtend();
  expect((await call(page, 'cad_get_feature', { expectedVersion: current.version, featureId: sketch.id })).feature).toEqual(sketch);
  await page.getByRole('button', { name: 'Cancel sketch edits', exact: true }).click(); expect((await context(page)).version).toBe(originalVersion);
  await openExtend(); await page.getByRole('button', { name: 'Finish sketch', exact: true }).click();
  await page.getByRole('button', { name: 'Choose areas for Segment plate', exact: true }).click();
  await page.getByRole('button', { name: 'View controls', exact: true }).click();
  await page.getByRole('combobox', { name: 'Named view', exact: true }).selectOption('Top');
  await page.getByRole('button', { name: 'Fit model', exact: true }).click();
  await page.getByRole('button', { name: 'View controls', exact: true }).click();
  const canvas = await page.getByLabel('3D model canvas').boundingBox(); if (!canvas) throw new Error('Area picker unavailable.');
  // Fitted from the top: the old segment at (6, 6) mm, then the added cell at (-1, 7.5) mm.
  await page.mouse.click(canvas.x + canvas.width * .631, canvas.y + canvas.height * .305);
  await page.keyboard.down('Shift'); await page.mouse.click(canvas.x + canvas.width * .505, canvas.y + canvas.height * .260); await page.keyboard.up('Shift');
  await page.getByRole('button', { name: 'Finish area selection', exact: true }).click(); await page.getByRole('button', { name: 'Finish sketch', exact: true }).click();
  await expect.poll(() => context(page)).toMatchObject({ workflowOpen: false }); current = await context(page);
  const human = (await call(page, 'cad_get_feature', { expectedVersion: current.version, featureId: sketch.id })).feature;
  const repairedPad = (await call(page, 'cad_get_feature', { expectedVersion: current.version, featureId: pad.id })).feature;
  expect(human).toEqual({ ...sketch, graph: { ...sketch.graph, entities: [{ ...sketch.graph!.entities[0], endPointId: 'c' }, ...sketch.graph!.entities.slice(1)] } });
  const volume = 250 * (Math.atan2(8, -6) - .8);
  expect((await call(page, 'cad_build', { expectedVersion: current.version })).bodies[0].volumeMm3).toBeCloseTo(volume, 7);
  await call(page, 'cad_history', { expectedVersion: current.version, direction: 'undo' }); current = await context(page);
  expect((await call(page, 'cad_get_feature', { expectedVersion: current.version, featureId: sketch.id })).feature).toEqual(sketch);
  expect((await call(page, 'cad_get_feature', { expectedVersion: current.version, featureId: pad.id })).feature).toEqual(pad);
  const query = await call(page, 'cad_inspect_sketch_regions', { expectedVersion: current.version, sketchId: sketch.id, mode: 'graph-cells', extendAt: { entityId: 'rim', end: 'end' } });
  const extend = { ...query.extendPreview.target, endPointId: 'c' }, proposal = { extend };
  expect(extend).toMatchObject({ kind: 'arc', entityId: 'rim', end: 'end', boundary: { endpointPointId: 'c' } });
  const areas = await call(page, 'cad_inspect_sketch_regions', { expectedVersion: current.version, sketchId: sketch.id, mode: 'graph-cells', proposal });
  expect(areas.items).toHaveLength(2); expect(await pack(areas.items.map((area: { cellId: number }) => area.cellId), proposal)).toEqual(repairedPad.regionSelection);
  const edit = { kind: 'extend-sketch-entity', sketchId: sketch.id, extend };
  expect((await raw(page, 'cad_edit_document', { expectedVersion: current.version, edits: [edit] })).ok).toBe(false); expect((await context(page)).version).toBe(current.version);
  await call(page, 'cad_edit_document', { expectedVersion: current.version, edits: [edit, { kind: 'update-feature', feature: repairedPad }] }); current = await context(page);
  expect((await call(page, 'cad_get_feature', { expectedVersion: current.version, featureId: sketch.id })).feature).toEqual(human);
  const built = await call(page, 'cad_build', { expectedVersion: current.version }); expect(built.diagnostics).toEqual([]);
  expect(built.bodies[0]).toMatchObject({ solidCount: 1 }); expect(built.bodies[0].volumeMm3).toBeCloseTo(volume, 7);
  await call(page, 'cad_save_document', { expectedVersion: current.version }); await page.reload();
  await expect(page.getByRole('main', { name: 'Parametric CAD workbench' })).toBeVisible(); current = await context(page);
  expect(current.dirty).toBe(false); expect((await call(page, 'cad_get_feature', { expectedVersion: current.version, featureId: sketch.id })).feature).toEqual(human);
  expect((await call(page, 'cad_get_feature', { expectedVersion: current.version, featureId: pad.id })).feature).toEqual(repairedPad);
});
