import { expect, test } from './fixtures/native-sketch-solver';
import type { CadSketchFeature } from '../src/domain/cad/cadDocument';
import { prepareCadTools, callCadTool as call, rawCadToolCall as raw, cadContext as context, historyRow } from './cad-tool-helpers';

test('mirrors a bore by picking its axis and keeps the copied bore independent through solid edits and save', async ({ page }) => {
  await prepareCadTools(page); await call(page, 'cad_open_workspace');
  const sketch: CadSketchFeature = { id: 'sketch', name: 'Mounting plate', kind: 'sketch', plane: 'XY', offset: 0, suppressed: false, profiles: [], graph: {
    points: [{ id: 'a', position: ['0', '0'] }, { id: 'b', position: ['60', '0'] }, { id: 'c', position: ['60', '30'] },
      { id: 'd', position: ['0', '30'] }, { id: 'bore-center', position: ['15', '15'] },
      { id: 'axis-a', position: ['30', '0'] }, { id: 'axis-b', position: ['30', '30'] }],
    entities: [{ id: 'ab', kind: 'line', startPointId: 'a', endPointId: 'b', construction: false },
      { id: 'bc', kind: 'line', startPointId: 'b', endPointId: 'c', construction: false },
      { id: 'cd', kind: 'line', startPointId: 'c', endPointId: 'd', construction: false },
      { id: 'da', kind: 'line', startPointId: 'd', endPointId: 'a', construction: false },
      { id: 'bore', kind: 'circle', centerPointId: 'bore-center', radius: ' boreDiameter / 2 ', construction: false },
      { id: 'axis', kind: 'line', startPointId: 'axis-a', endPointId: 'axis-b', construction: true }], relations: [] } };
  await call(page, 'cad_edit_document', { expectedVersion: (await context(page)).version, edits: [
    { kind: 'set-parameter', name: 'boreDiameter', value: 6 }, { kind: 'add-feature', feature: sketch }] });
  let current = await context(page);
  const areas = await call(page, 'cad_inspect_sketch_regions', { expectedVersion: current.version, sketchId: sketch.id, mode: 'graph-cells' });
  const material = areas.items.reduce((largest: { areaMm2: number; cellId: number }, area: { areaMm2: number; cellId: number }) => area.areaMm2 > largest.areaMm2 ? area : largest);
  const chunk = await call(page, 'cad_read_sketch_region_reference', { expectedVersion: current.version, sketchId: sketch.id, cellIds: [material.cellId], offset: 0, length: 4096 });
  expect(chunk.nextOffset).toBeNull();
  const pad = { id: 'pad', name: 'Plate thickness', kind: 'extrude', sketchId: sketch.id, suppressed: false, distance: 5, symmetric: false,
    operation: 'new', targetId: null, regionSelection: JSON.parse(chunk.text) };
  await call(page, 'cad_edit_document', { expectedVersion: current.version, edits: [{ kind: 'add-feature', feature: pad }] }); current = await context(page);
  expect((await call(page, 'cad_build', { expectedVersion: current.version })).bodies[0].volumeMm3).toBeCloseTo(9000 - 45 * Math.PI, 7);
  const base = current, read = (id: string) => call(page, 'cad_get_feature', { expectedVersion: current.version, featureId: id }).then(reply => reply.feature);
  const open = async () => {
    await (await historyRow(page, 'Mounting plate')).dblclick();
    await page.locator('[data-cad-sketch-entity="bore"]').press('Enter');
    await page.getByRole('button', { name: 'Mirror copy', exact: true }).click();
  };
  await open(); await expect(page.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled();
  // Background and disabled point grips leave the source circle selected.
  await page.locator('[data-cad-sketch-point="bore-center"]').click({ force: true });
  await expect(page.locator('[data-cad-sketch-entity="bore"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-cad-sketch-entity="axis"]').press('Enter');
  await expect(page.getByRole('button', { name: 'Apply', exact: true })).toBeEnabled();
  expect(await read(sketch.id)).toEqual(sketch);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('form', { name: 'Mirror copy', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Cancel sketch edits', exact: true }).click();
  expect((await context(page)).version).toBe(base.version); expect(await read(pad.id)).toEqual(pad);
  await open(); await page.locator('[data-cad-sketch-entity="axis"]').press('Enter');
  await expect(page.getByRole('button', { name: 'Apply', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Change line', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled();
  await page.locator('[data-cad-sketch-entity="axis"]').press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Use as mirror line', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Apply', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByRole('form', { name: 'Mirror copy', exact: true })).toHaveCount(0);
  const copiedId = await page.locator('[data-cad-sketch-entity][aria-pressed="true"]').getAttribute('data-cad-sketch-entity');
  expect(copiedId).toMatch(/^mirror_.*_e0$/);
  expect(await read(sketch.id)).toEqual(sketch);
  await page.getByRole('button', { name: 'Finish sketch', exact: true }).click();
  await page.getByRole('button', { name: 'Choose areas for Plate thickness', exact: true }).click();
  const canvas = await page.getByLabel('3D model canvas').boundingBox(); if (!canvas) throw new Error('Area picker missing.');
  await page.mouse.click(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
  await page.getByRole('button', { name: 'Finish area selection', exact: true }).click();
  await page.getByRole('button', { name: 'Finish sketch', exact: true }).click();
  await expect.poll(() => context(page)).toMatchObject({ workflowOpen: false }); current = await context(page);
  const human = await read(sketch.id), repairedPad = await read(pad.id), prefix = copiedId!.slice(0, -3);
  expect(human.graph).toEqual({ ...sketch.graph, points: [...sketch.graph!.points, { id: prefix + '_p0', position: [45, 15] }],
    entities: [...sketch.graph!.entities, { id: copiedId, kind: 'circle', centerPointId: prefix + '_p0', radius: 3, construction: false }] });
  expect((await call(page, 'cad_build', { expectedVersion: current.version })).bodies[0].volumeMm3).toBeCloseTo(9000 - 90 * Math.PI, 7);
  await call(page, 'cad_history', { expectedVersion: current.version, direction: 'undo' }); current = await context(page);
  expect(await read(sketch.id)).toEqual(sketch); expect(await read(pad.id)).toEqual(pad);
  const mirror = { entityIds: ['bore'], axisLineId: 'axis', idPrefix: prefix }, proposal = { mirror };
  const query = await call(page, 'cad_inspect_sketch_regions', { expectedVersion: current.version, sketchId: sketch.id, mode: 'graph-cells', proposal });
  const plateArea = query.items.reduce((largest: { areaMm2: number; cellId: number }, area: { areaMm2: number; cellId: number }) => area.areaMm2 > largest.areaMm2 ? area : largest);
  const reference = await call(page, 'cad_read_sketch_region_reference', { expectedVersion: current.version, sketchId: sketch.id, cellIds: [plateArea.cellId], proposal, offset: 0, length: 4096 });
  expect(reference.nextOffset).toBeNull(); expect(JSON.parse(reference.text)).toEqual(repairedPad.regionSelection);
  const edit = { kind: 'mirror-sketch-geometry', sketchId: sketch.id, ...mirror };
  expect((await raw(page, 'cad_edit_document', { expectedVersion: current.version, edits: [edit] })).ok).toBe(false);
  expect((await context(page)).version).toBe(current.version);
  await call(page, 'cad_edit_document', { expectedVersion: current.version, edits: [edit, { kind: 'update-feature', feature: repairedPad }] }); current = await context(page);
  expect(await read(sketch.id)).toEqual(human); expect(await read(pad.id)).toEqual(repairedPad);
  // The detached copy acquires its own ordinary diameter, without stealing the source expression.
  await (await historyRow(page, 'Mounting plate')).dblclick();
  await page.locator('[data-cad-sketch-entity="' + copiedId + '"]').press('Enter');
  // Dimension starts from the selected copy: Enter places its diameter at the copied size and selects it, and Enter again opens its editor.
  await page.getByRole('button', { name: 'Dimension', exact: true }).click(); await page.getByLabel('Sketch drawing canvas').press('Enter');
  await expect(page.locator('[data-cad-sketch-dimension] [role="button"][aria-pressed="true"]')).toHaveCount(1);
  await page.getByLabel('Sketch drawing canvas').press('Enter');
  await page.getByRole('textbox', { name: 'Diameter mm', exact: true }).fill('8');
  await expect(page.getByRole('button', { name: 'Apply', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.getByRole('button', { name: 'Finish sketch', exact: true }).click();
  await expect.poll(() => context(page)).toMatchObject({ workflowOpen: false }); current = await context(page);
  expect((await call(page, 'cad_build', { expectedVersion: current.version })).bodies[0].volumeMm3).toBeCloseTo(9000 - 125 * Math.PI, 7);
  await call(page, 'cad_edit_document', { expectedVersion: current.version, edits: [{ kind: 'set-parameter', name: 'boreDiameter', value: 10 }] }); current = await context(page);
  const grown = await read(sketch.id);
  expect(grown.graph.points).toEqual(human.graph.points);
  expect(grown.graph.entities).toEqual(human.graph.entities.map((entity: { id: string }) => entity.id === copiedId ? { ...entity, radius: 4 } : entity));
  expect(grown.graph.relations).toEqual([expect.objectContaining({ kind: 'radial-size', entityId: copiedId, quantity: 'diameter', value: 8 })]);
  const built = await call(page, 'cad_build', { expectedVersion: current.version });
  expect(built.diagnostics).toEqual([]); expect(built.bodies[0].solidCount).toBe(1); expect(built.bodies[0].volumeMm3).toBeCloseTo(9000 - 205 * Math.PI, 7);
  const section = await call(page, 'cad_inspect_section', { expectedVersion: current.version, section: { bodyId: pad.id, plane: 'XY', offset: 2.5 } });
  expect(section.contourCount).toBe(3); expect(section.entities.nextOffset).toBeNull();
  expect(section.entities.items.filter((entity: { type: string }) => entity.type === 'line')).toHaveLength(4);
  const arcs = section.entities.items.filter((entity: { type: string }) => entity.type === 'arc');
  expect(arcs).toHaveLength(4);
  for (const [x, radius] of [[15, 5], [45, 4]]) {
    const halves = arcs.filter((entity: { center: { x: number } }) => entity.center.x === x);
    expect(halves).toHaveLength(2);
    for (const half of halves) expect(half).toMatchObject({ center: { x, y: 15 }, radius, sweepRadians: expect.closeTo(-Math.PI, 10) });
    expect(halves[0].start).toEqual(halves[1].end); expect(halves[0].end).toEqual(halves[1].start);
  }
  await call(page, 'cad_history', { expectedVersion: current.version, direction: 'undo' }); current = await context(page);
  expect(current.parameters.boreDiameter).toBe(6); expect((await read(sketch.id)).graph.entities).toEqual(grown.graph.entities);
  await call(page, 'cad_history', { expectedVersion: current.version, direction: 'redo' }); current = await context(page);
  expect(await read(sketch.id)).toEqual(grown);
  await call(page, 'cad_save_document', { expectedVersion: current.version }); await page.reload();
  await expect(page.getByRole('main', { name: 'Parametric CAD workbench' })).toBeVisible(); current = await context(page);
  expect(current.dirty).toBe(false); expect(current.parameters.boreDiameter).toBe(10); expect(await read(sketch.id)).toEqual(grown); expect(await read(pad.id)).toEqual(repairedPad);
});
