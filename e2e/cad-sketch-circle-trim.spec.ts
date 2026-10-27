import { expect, test } from './fixtures/native-sketch-solver';
import type { CadSketchFeature } from '../src/domain/cad/cadDocument';
import { prepareCadTools, callCadTool as call, rawCadToolCall as raw, cadContext as context, historyRow } from './cad-tool-helpers';

test('trims a circle cap, deliberately repairs its consumed area and matches exact agent history through save', async ({ page }) => {
  await prepareCadTools(page); await call(page, 'cad_open_workspace');
  const sketch: CadSketchFeature = { id: 'outline', kind: 'sketch', name: 'Round blank', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: {
    points: [{ id: 'center', position: [' 0.00 ', '0'] }, { id: 'a', position: ['-8', '6'] }, { id: 'b', position: ['8', '6'] }],
    entities: [{ id: 'rim', kind: 'circle', centerPointId: 'center', radius: 10, construction: false },
      { id: 'chord', kind: 'line', startPointId: 'a', endPointId: 'b', construction: false }], relations: []
  } };
  await call(page, 'cad_edit_document', { expectedVersion: (await context(page)).version, edits: [{ kind: 'add-feature', feature: sketch }] });
  let current = await context(page);
  const pack = async (cellIds: number[], proposal?: unknown) => {
    let text = '', offset = 0;
    for (;;) {
      const chunk = await call(page, 'cad_read_sketch_region_reference', { expectedVersion: current.version, sketchId: sketch.id,
        cellIds, ...(proposal ? { proposal } : {}), offset, length: 4096 });
      text += chunk.text; if (chunk.nextOffset === null) return JSON.parse(text);
      expect(chunk.nextOffset).toBeGreaterThan(offset); offset = chunk.nextOffset;
    }
  };
  const original = await call(page, 'cad_inspect_sketch_regions', { expectedVersion: current.version, sketchId: sketch.id, mode: 'graph-cells' });
  expect(original.items).toHaveLength(2);
  const pad = { id: 'pad', kind: 'extrude', name: 'Round plate', suppressed: false, sketchId: sketch.id,
    regionSelection: await pack(original.items.map((item: { cellId: number }) => item.cellId)), distance: ' 5e0 ', symmetric: false, operation: 'new', targetId: null };
  await call(page, 'cad_edit_document', { expectedVersion: current.version, edits: [{ kind: 'add-feature', feature: pad }] }); current = await context(page);
  const base = current, readFeature = (id: string) => call(page, 'cad_get_feature', { expectedVersion: current.version, featureId: id }).then(reply => reply.feature);
  expect((await call(page, 'cad_build', { expectedVersion: current.version })).bodies[0].volumeMm3).toBeCloseTo(500 * Math.PI, 7);
  const openTrim = async () => {
    await (await historyRow(page, 'Round blank')).dblclick();
    const cap = await page.locator('[data-cad-sketch-entity="rim"] > circle').evaluate(element => {
      const circle = element as SVGCircleElement, matrix = circle.getScreenCTM(); if (!matrix) throw new Error('Circle projection unavailable.');
      const point = new DOMPoint(circle.cx.baseVal.value, circle.cy.baseVal.value + circle.r.baseVal.value).matrixTransform(matrix);
      return { x: point.x, y: point.y };
    });
    await page.mouse.click(cap.x, cap.y, { button: 'right' });
    const trim = page.getByRole('menuitem', { name: 'Trim here', exact: true }); await expect(trim).toBeEnabled(); await trim.focus();
    await expect(page.getByLabel('Trim preview', { exact: true }).locator('.is-retained')).toBeVisible();
    await trim.click(); await expect(page.locator('[data-cad-sketch-point="b"]')).toHaveAttribute('aria-pressed', 'true');
  };
  await openTrim(); expect(await readFeature(sketch.id)).toEqual(sketch);
  await page.getByRole('button', { name: 'Cancel sketch edits', exact: true }).click();
  expect((await context(page)).version).toBe(base.version); expect(await readFeature(pad.id)).toEqual(pad);
  await openTrim(); await page.getByRole('button', { name: 'Finish sketch', exact: true }).click();
  await expect(page.getByRole('form', { name: 'Update dependent sketch areas', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Choose areas for Round plate', exact: true }).click();
  const canvas = await page.getByLabel('3D model canvas').boundingBox(); if (!canvas) throw new Error('Area picker unavailable.');
  await page.mouse.click(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
  await page.getByRole('button', { name: 'Finish area selection', exact: true }).click();
  await page.getByRole('button', { name: 'Finish sketch', exact: true }).click();
  await expect.poll(() => context(page)).toMatchObject({ workflowOpen: false }); current = await context(page);
  const human = await readFeature(sketch.id), repairedPad = await readFeature(pad.id);
  expect(human).toEqual({ ...sketch, graph: { ...sketch.graph, entities: [
    { id: 'rim', kind: 'arc', centerPointId: 'center', startPointId: 'a', endPointId: 'b', direction: 'ccw', construction: false }, sketch.graph!.entities[1]
  ] } });
  const volume = (100 * Math.PI - (100 * Math.acos(.6) - 48)) * 5;
  expect((await call(page, 'cad_build', { expectedVersion: current.version })).bodies[0].volumeMm3).toBeCloseTo(volume, 7);
  await call(page, 'cad_history', { expectedVersion: current.version, direction: 'undo' }); current = await context(page);
  expect(await readFeature(sketch.id)).toEqual(sketch); expect(await readFeature(pad.id)).toEqual(pad);
  const query = await call(page, 'cad_inspect_sketch_regions', { expectedVersion: current.version, sketchId: sketch.id, mode: 'graph-cells', trimAt: { entityId: 'rim', parameter: .25 } });
  const trim = { ...query.trimPreview.target, cutPointIds: ['b', 'a'] }, proposal = { trim };
  const areas = await call(page, 'cad_inspect_sketch_regions', { expectedVersion: current.version, sketchId: sketch.id, mode: 'graph-cells', proposal });
  expect(areas.items).toHaveLength(1); expect(areas.items[0].areaMm2).toBeCloseTo(volume / 5, 8);
  expect(await pack([areas.items[0].cellId], proposal)).toEqual(repairedPad.regionSelection);
  const edit = { kind: 'trim-sketch-entity', sketchId: sketch.id, trim };
  expect((await raw(page, 'cad_edit_document', { expectedVersion: current.version, edits: [edit] })).ok).toBe(false);
  expect((await context(page)).version).toBe(current.version); expect(await readFeature(sketch.id)).toEqual(sketch);
  await call(page, 'cad_edit_document', { expectedVersion: current.version, edits: [edit, { kind: 'update-feature', feature: repairedPad }] }); current = await context(page);
  expect(await readFeature(sketch.id)).toEqual(human); expect(await readFeature(pad.id)).toEqual(repairedPad);
  const built = await call(page, 'cad_build', { expectedVersion: current.version });
  expect(built.diagnostics).toEqual([]); expect(built.bodies[0]).toMatchObject({ solidCount: 1 }); expect(built.bodies[0].volumeMm3).toBeCloseTo(volume, 7);
  await call(page, 'cad_save_document', { expectedVersion: current.version }); await page.reload();
  await expect(page.getByRole('main', { name: 'Parametric CAD workbench' })).toBeVisible(); current = await context(page);
  expect(current.dirty).toBe(false); expect(await readFeature(sketch.id)).toEqual(human); expect(await readFeature(pad.id)).toEqual(repairedPad);
});
