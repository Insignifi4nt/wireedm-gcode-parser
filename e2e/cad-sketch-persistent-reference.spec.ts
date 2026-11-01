import { expect, test } from './fixtures/native-sketch-solver';
import type { CadSketchFeature } from '../src/domain/cad/cadDocument';
import { prepareCadTools, callCadTool as call, rawCadToolCall as raw, cadContext as context, historyRow, relationOffer } from './cad-tool-helpers';

test('uses a layout edge on a raised sketch, follows source edits and explicitly detaches without losing its bore', async ({ page }) => {
  await prepareCadTools(page); await call(page, 'cad_open_workspace');
  const layout: CadSketchFeature = { id: 'layout', name: 'Layout', kind: 'sketch', suppressed: false, plane: 'XY', offset: ' sourceLift ', profiles: [], graph: {
    points: [{ id: 'a', position: [' 0 ', 10] }, { id: 'b', position: [' span ', 10] }],
    entities: [{ id: 'guide', kind: 'line', startPointId: 'a', endPointId: 'b', construction: true }], relations: []
  } };
  const plate: CadSketchFeature = { id: 'plate', name: 'Raised plate', kind: 'sketch', suppressed: false, plane: 'XY', offset: ' 5.0 ', profiles: [], graph: {
    points: [{ id: 'a', position: ['0', '0'] }, { id: 'b', position: ['80', '0'] }, { id: 'c', position: ['80', '20'] },
      { id: 'd', position: ['0', '20'] }, { id: 'center', position: [20, 10] }],
    entities: [{ id: 'ab', kind: 'line', startPointId: 'a', endPointId: 'b', construction: false },
      { id: 'bc', kind: 'line', startPointId: 'b', endPointId: 'c', construction: false },
      { id: 'cd', kind: 'line', startPointId: 'c', endPointId: 'd', construction: false },
      { id: 'da', kind: 'line', startPointId: 'd', endPointId: 'a', construction: false },
      { id: 'bore', kind: 'circle', centerPointId: 'center', radius: ' 3.0 ', construction: false }], relations: []
  } };
  const pad = { id: 'pad', name: 'Raised plate thickness', kind: 'extrude', suppressed: false, sketchId: plate.id, distance: 5, symmetric: false, operation: 'new', targetId: null };
  await call(page, 'cad_edit_document', { expectedVersion: (await context(page)).version, edits: [
    { kind: 'set-parameter', name: 'span', value: 40 }, { kind: 'set-parameter', name: 'sourceLift', value: 0 },
    { kind: 'add-feature', feature: layout }, { kind: 'add-feature', feature: plate }, { kind: 'add-feature', feature: pad }
  ] });
  let current = await context(page); const initial = current;
  const read = (id: string) => call(page, 'cad_get_feature', { expectedVersion: current.version, featureId: id }).then(reply => reply.feature);
  const openUse = async () => {
    await (await historyRow(page, 'Raised plate')).dblclick();
    await expect(page.getByRole('button', { name: 'Use reference', exact: true })).toBeVisible({ timeout: 2000 });
    await page.getByRole('button', { name: 'Use reference', exact: true }).click();
    await (await historyRow(page, 'Layout')).click();
    await page.locator('[data-cad-sketch-entity="guide"]').press('Enter');
    await expect(page.getByRole('button', { name: 'Apply', exact: true })).toBeEnabled();
  };
  await openUse(); await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel sketch edits', exact: true }).click();
  expect((await context(page)).version).toBe(initial.version); expect(await read(plate.id)).toEqual(plate);
  await openUse(); await page.getByRole('button', { name: 'Apply', exact: true }).click();
  const referenceId = await page.locator('[data-cad-sketch-entity][aria-pressed="true"]').getAttribute('data-cad-sketch-entity');
  expect(referenceId).toBeTruthy();
  await page.locator('[data-cad-sketch-point="center"]').press('Enter');
  await page.locator('[data-cad-sketch-entity="' + referenceId + '"]').press('Shift+Enter');
  await relationOffer(page, 'Midpoint').click(); await expect(relationOffer(page, 'Midpoint')).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Finish sketch', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Finish sketch', exact: true })).toHaveCount(0); current = await context(page);
  const linked = await read(plate.id), reference = linked.graph.relations.find((relation: { kind: string }) => relation.kind === 'external-reference');
  const midpoint = linked.graph.relations.find((relation: { kind: string }) => relation.kind === 'midpoint');
  expect(reference).toMatchObject({ entityId: referenceId, sourceSketchId: layout.id, source: { kind: 'line', entityId: 'guide', startPointId: 'a', endPointId: 'b' } });
  expect(await read(layout.id)).toEqual(layout); expect(linked.offset).toBe(' 5.0 ');
  await call(page, 'cad_history', { expectedVersion: current.version, direction: 'undo' }); current = await context(page);
  expect(await read(plate.id)).toEqual(plate);
  await call(page, 'cad_edit_document', { expectedVersion: current.version, edits: [
    { kind: 'use-sketch-entity', sketchId: plate.id, sourceSketchId: layout.id, sourceEntityId: 'guide', idPrefix: reference.id.slice(0, -10) },
    { kind: 'set-sketch-relation', sketchId: plate.id, relation: midpoint }
  ] }); current = await context(page); expect(await read(plate.id)).toEqual(linked);
  await call(page, 'cad_edit_document', { expectedVersion: current.version, edits: [{ kind: 'set-parameter', name: 'span', value: 60 }, { kind: 'set-parameter', name: 'sourceLift', value: 2 }] }); current = await context(page);
  const followed = await read(plate.id);
  expect(followed.graph.points.find((point: { id: string }) => point.id === 'center').position).toEqual([expect.closeTo(30, 10), expect.closeTo(10, 10)]);
  expect(await read(layout.id)).toEqual(layout); expect(followed.offset).toBe(' 5.0 ');
  await call(page, 'cad_edit_document', { expectedVersion: current.version, edits: [{ kind: 'translate-sketch-geometry', sketchId: layout.id, selections: [{ kind: 'entity', id: 'guide' }], translation: [0, 2] }] }); current = await context(page);
  const moved = await read(plate.id), movedLayout = await read(layout.id);
  expect(moved.graph.points.find((point: { id: string }) => point.id === 'center').position).toEqual([expect.closeTo(30, 10), expect.closeTo(12, 10)]);
  expect(movedLayout).toEqual({ ...layout, graph: { ...layout.graph, points: [{ id: 'a', position: [' 0 ', 12] }, { id: 'b', position: [' span ', 12] }] } });
  const built = await call(page, 'cad_build', { expectedVersion: current.version });
  expect(built.diagnostics).toEqual([]); expect(built.bodies).toHaveLength(1);
  expect(built.bodies[0]).toMatchObject({ solidCount: 1, boundsMm: { min: [0, 0, 5], max: [80, 20, 10] } });
  expect(built.bodies[0].volumeMm3).toBeCloseTo(5 * (1600 - 9 * Math.PI), 7);
  const section = await call(page, 'cad_inspect_section', { expectedVersion: current.version, section: { bodyId: pad.id, plane: 'XY', offset: 7.5 } });
  expect(section.contourCount).toBe(2);
  const arcs = section.entities.items.filter((entity: { type: string }) => entity.type === 'arc'); expect(arcs).toHaveLength(2);
  for (const arc of arcs) expect(arc).toMatchObject({ radius: 3, center: { x: expect.closeTo(30, 9), y: expect.closeTo(12, 9) } });
  expect((await raw(page, 'cad_edit_document', { expectedVersion: current.version, edits: [{ kind: 'update-feature', feature: { ...movedLayout, suppressed: true } }] })).ok).toBe(false);
  expect((await context(page)).version).toBe(current.version);
  await (await historyRow(page, 'Raised plate')).dblclick();
  await page.locator('[data-cad-sketch-entity="' + referenceId + '"]').press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Detach reference', exact: true }).click();
  await page.getByRole('button', { name: 'Finish sketch', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Finish sketch', exact: true })).toHaveCount(0); current = await context(page);
  const detached = await read(plate.id); expect(detached.graph.relations).toEqual([midpoint]); expect(detached.graph.points).toEqual(moved.graph.points);
  await call(page, 'cad_edit_document', { expectedVersion: current.version, edits: [{ kind: 'set-parameter', name: 'span', value: 80 }] }); current = await context(page);
  expect(await read(plate.id)).toEqual(detached);
  for (let index = 0; index < 2; index++) { await call(page, 'cad_history', { expectedVersion: current.version, direction: 'undo' }); current = await context(page); }
  expect(await read(plate.id)).toEqual(moved); expect(await read(layout.id)).toEqual(movedLayout);
  await call(page, 'cad_save_document', { expectedVersion: current.version }); await page.reload();
  await expect(page.getByRole('main', { name: 'Parametric CAD workbench' })).toBeVisible(); current = await context(page);
  expect(current.dirty).toBe(false); expect(await read(plate.id)).toEqual(moved); expect(await read(layout.id)).toEqual(movedLayout); expect(await read(pad.id)).toEqual(pad);
});
