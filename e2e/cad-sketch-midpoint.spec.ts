import { expect, test } from '@playwright/test';
import type { CadSketchFeature } from '../src/domain/cad/cadDocument';
import { prepareCadTools, callCadTool as call, rawCadToolCall as raw, cadContext as context, historyRow, relationControl } from './cad-tool-helpers';

test('keeps a bore centered through line changes, deliberate detachment, exact history and save', async ({ page }) => {
  await prepareCadTools(page); await call(page, 'cad_open_workspace');
  const sketch: CadSketchFeature = { id: 'plate', kind: 'sketch', name: 'Centered bore', plane: 'XY', offset: 0, suppressed: false, profiles: [], graph: {
    points: [{ id: 'a', position: [' 0.00 ', '0'] }, { id: 'b', position: [' width ', '0'] },
      { id: 'c', position: [' width ', '20'] }, { id: 'd', position: ['0', '20'] }, { id: 'center', position: [20, 10] }],
    entities: [{ id: 'bottom', kind: 'line', startPointId: 'a', endPointId: 'b', construction: false },
      { id: 'right', kind: 'line', startPointId: 'b', endPointId: 'c', construction: false },
      { id: 'top', kind: 'line', startPointId: 'c', endPointId: 'd', construction: false },
      { id: 'left', kind: 'line', startPointId: 'd', endPointId: 'a', construction: false },
      { id: 'guide', kind: 'line', startPointId: 'a', endPointId: 'c', construction: true },
      { id: 'bore', kind: 'circle', centerPointId: 'center', radius: ' 4.00 ', construction: false }], relations: []
  } };
  const pad = { id: 'pad', kind: 'extrude', name: 'Thickness', suppressed: false, sketchId: sketch.id, distance: ' 5e0 ', symmetric: false, operation: 'new', targetId: null };
  await call(page, 'cad_edit_document', { expectedVersion: (await context(page)).version, edits: [
    { kind: 'set-parameter', name: 'width', value: 40 }, { kind: 'add-feature', feature: sketch }, { kind: 'add-feature', feature: pad }
  ] }); let current = await context(page); const initialVersion = current.version;
  const readSketch = () => call(page, 'cad_get_feature', { expectedVersion: current.version, featureId: sketch.id }).then(reply => reply.feature);
  const selectPair = async () => {
    await page.getByRole('button', { name: 'Point 5 in Centered bore', exact: true }).press('Enter');
    await page.locator('[data-cad-sketch-entity="guide"][role="button"]').press('Shift+Enter');
  };
  await (await historyRow(page, 'Centered bore')).dblclick();
  await selectPair(); await (await relationControl(page, 'checkbox', 'Midpoint')).check();
  expect(await readSketch()).toEqual(sketch); await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect((await context(page)).version).toBe(initialVersion);
  await (await relationControl(page, 'checkbox', 'Midpoint')).check();
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.getByRole('button', { name: 'Finish sketch', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Finish sketch', exact: true })).toHaveCount(0); current = await context(page);
  const linked = await readSketch();
  expect(linked.graph.points).toEqual(sketch.graph!.points); expect(linked.graph.entities).toEqual(sketch.graph!.entities);
  expect(linked.graph.relations).toEqual([{ id: expect.any(String), kind: 'midpoint', pointId: 'center', lineId: 'guide' }]);
  await call(page, 'cad_history', { expectedVersion: current.version, direction: 'undo' }); current = await context(page);
  expect(await readSketch()).toEqual(sketch);
  await call(page, 'cad_edit_document', { expectedVersion: current.version, edits: [{ kind: 'set-sketch-relation', sketchId: sketch.id, relation: linked.graph.relations[0] }] });
  current = await context(page); expect(await readSketch()).toEqual(linked);
  await call(page, 'cad_edit_document', { expectedVersion: current.version, edits: [{ kind: 'set-parameter', name: 'width', value: 60 }] }); current = await context(page);
  const widened = await readSketch();
  expect(widened).toEqual({ ...linked, graph: { ...linked.graph, points: [...sketch.graph!.points.slice(0, 4),
    { id: 'center', position: [expect.closeTo(30, 9), expect.closeTo(10, 9)] }] } });
  expect((await raw(page, 'cad_edit_document', { expectedVersion: current.version, edits: [{ kind: 'update-feature', feature: {
    ...widened, graph: { ...widened.graph, points: [...widened.graph.points.slice(0, 4), { id: 'center', position: ['0', '0'] }] }
  } }] })).ok).toBe(false); expect((await context(page)).version).toBe(current.version); expect(await readSketch()).toEqual(widened);
  await (await historyRow(page, 'Centered bore')).dblclick();
  await selectPair(); await (await relationControl(page, 'checkbox', 'Midpoint')).uncheck();
  await page.getByRole('button', { name: 'Apply', exact: true }).click(); await page.getByRole('button', { name: 'Finish sketch', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Finish sketch', exact: true })).toHaveCount(0); current = await context(page);
  expect((await readSketch()).graph).toEqual({ ...widened.graph, relations: [] });
  await call(page, 'cad_edit_document', { expectedVersion: current.version, edits: [{ kind: 'set-parameter', name: 'width', value: 80 }] }); current = await context(page);
  expect((await readSketch()).graph.points[4].position).toEqual(widened.graph.points[4].position);
  for (let step = 0; step < 2; step++) { await call(page, 'cad_history', { expectedVersion: current.version, direction: 'undo' }); current = await context(page); }
  expect(await readSketch()).toEqual(widened);
  const built = await call(page, 'cad_build', { expectedVersion: current.version });
  expect(built.diagnostics).toEqual([]); expect(built.bodies[0]).toMatchObject({ solidCount: 1 });
  expect(built.bodies[0].volumeMm3).toBeCloseTo((60 * 20 - 16 * Math.PI) * 5, 6);
  await call(page, 'cad_save_document', { expectedVersion: current.version }); await page.reload();
  await expect(page.getByRole('main', { name: 'Parametric CAD workbench' })).toBeVisible(); current = await context(page);
  expect(current.dirty).toBe(false); expect(await readSketch()).toEqual(widened);
  expect((await call(page, 'cad_get_feature', { expectedVersion: current.version, featureId: pad.id })).feature).toEqual(pad);
});
