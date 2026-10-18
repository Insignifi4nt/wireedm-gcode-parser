import { expect, test } from '@playwright/test';
import type { CadSketchFeature } from '../src/domain/cad/cadDocument';
import { prepareCadTools, callCadTool as call, rawCadToolCall as raw, cadContext as context, historyRow } from './cad-tool-helpers';

test('trims a middle arc, retains its radius owners and repairs the same human and agent part through save', async ({ page }) => {
  await prepareCadTools(page); await call(page, 'cad_open_workspace');
  const sketch: CadSketchFeature = { id: 'outline', kind: 'sketch', name: 'D blank', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: {
    points: [{ id: 'center', position: [' 0.00 ', '0'] }, { id: 'a', position: [-8, 6] }, { id: 'b', position: [8, 6] },
      { id: 'p', position: [-6, -8] }, { id: 'q', position: [6, -8] }, { id: 'left', position: ['-6', '0'] }, { id: 'right', position: ['6', '0'] },
      { id: 'peer-center', position: ['35.000', '0.000'] }],
    entities: [{ id: 'rim', kind: 'arc', centerPointId: 'center', startPointId: 'a', endPointId: 'b', direction: 'ccw', construction: false },
      { id: 'top', kind: 'line', startPointId: 'b', endPointId: 'a', construction: false },
      { id: 'bottom', kind: 'line', startPointId: 'p', endPointId: 'q', construction: false },
      { id: 'left-guide', kind: 'line', startPointId: 'p', endPointId: 'left', construction: true },
      { id: 'right-guide', kind: 'line', startPointId: 'q', endPointId: 'right', construction: true },
      { id: 'peer', kind: 'circle', centerPointId: 'peer-center', radius: 10, construction: true }], relations: [
      { id: 'stock-radius', kind: 'radial-size', entityId: 'rim', quantity: 'radius', value: ' stockRadius ' },
      { id: 'matched-radius', kind: 'equal-radius', curveIds: ['peer', 'rim'] }]
  } };
  await call(page, 'cad_edit_document', { expectedVersion: (await context(page)).version, edits: [
    { kind: 'set-parameter', name: 'stockRadius', value: 10 }, { kind: 'add-feature', feature: sketch }] });
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
  const pad = { id: 'pad', kind: 'extrude', name: 'D plate', suppressed: false, sketchId: sketch.id,
    regionSelection: await pack(original.items.map((item: { cellId: number }) => item.cellId)), distance: ' 5e0 ', symmetric: false, operation: 'new', targetId: null };
  await call(page, 'cad_edit_document', { expectedVersion: current.version, edits: [{ kind: 'add-feature', feature: pad }] }); current = await context(page);
  const base = current, readFeature = (id: string) => call(page, 'cad_get_feature', { expectedVersion: current.version, featureId: id }).then(reply => reply.feature);
  expect((await call(page, 'cad_build', { expectedVersion: current.version })).bodies[0].volumeMm3).toBeCloseTo((100 * Math.PI - (100 * Math.acos(.6) - 48)) * 5, 7);
  const openTrim = async () => {
    await (await historyRow(page, 'D blank')).dblclick();
    const a = await page.locator('[data-cad-sketch-point="a"]').boundingBox(), b = await page.locator('[data-cad-sketch-point="b"]').boundingBox();
    if (!a || !b) throw new Error('Arc endpoints unavailable.');
    const ax = a.x + a.width / 2, bx = b.x + b.width / 2;
    await page.mouse.click((ax + bx) / 2, a.y + a.height / 2 + bx - ax, { button: 'right' });
    const trim = page.getByRole('menuitem', { name: 'Trim here', exact: true }); await expect(trim).toBeEnabled(); await trim.focus();
    await expect(page.getByLabel('Trim preview', { exact: true }).locator('path.is-retained')).toHaveCount(2);
    await trim.click(); await expect(page.locator('[data-cad-sketch-point="p"]')).toHaveAttribute('aria-pressed', 'true');
  };
  await openTrim(); expect(await readFeature(sketch.id)).toEqual(sketch);
  await page.getByRole('button', { name: 'Cancel sketch edits', exact: true }).click();
  expect((await context(page)).version).toBe(base.version); expect(await readFeature(pad.id)).toEqual(pad);
  await openTrim(); await page.getByRole('button', { name: 'Finish sketch', exact: true }).click();
  await expect(page.getByRole('form', { name: 'Update dependent sketch areas', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Choose areas for D plate', exact: true }).click();
  const canvas = await page.getByLabel('3D model canvas').boundingBox(); if (!canvas) throw new Error('Area picker unavailable.');
  await page.mouse.click(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
  await page.getByRole('button', { name: 'Finish area selection', exact: true }).click();
  await page.getByRole('button', { name: 'Finish sketch', exact: true }).click();
  await expect.poll(() => context(page)).toMatchObject({ workflowOpen: false }); current = await context(page);
  const human = await readFeature(sketch.id), repairedPad = await readFeature(pad.id);
  const child = human.graph.entities.find((entity: { id: string }) => !sketch.graph!.entities.some(original => original.id === entity.id));
  expect(child).toEqual({ ...sketch.graph!.entities[0], id: expect.any(String), startPointId: 'q' });
  expect(human.graph).toEqual({ ...sketch.graph, entities: [{ ...sketch.graph!.entities[0], endPointId: 'p' }, child, ...sketch.graph!.entities.slice(1)],
    relations: [...sketch.graph!.relations, { id: expect.any(String), kind: 'equal-radius', curveIds: ['rim', child.id] }] });
  const volume = (50 * Math.PI + 96) * 5;
  expect((await call(page, 'cad_build', { expectedVersion: current.version })).bodies[0].volumeMm3).toBeCloseTo(volume, 7);
  await call(page, 'cad_history', { expectedVersion: current.version, direction: 'undo' }); current = await context(page);
  expect(await readFeature(sketch.id)).toEqual(sketch); expect(await readFeature(pad.id)).toEqual(pad);
  const query = await call(page, 'cad_inspect_sketch_regions', { expectedVersion: current.version, sketchId: sketch.id, mode: 'graph-cells', trimAt: { entityId: 'rim', parameter: .5 } });
  const trim = { ...query.trimPreview.target, cutPointIds: ['p', 'q'], newEntityId: child.id, supportRelationId: human.graph.relations.at(-1).id }, proposal = { trim };
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
  await call(page, 'cad_edit_document', { expectedVersion: current.version, edits: [{ kind: 'set-parameter', name: 'stockRadius', value: 12 }] }); current = await context(page);
  const resized = await readFeature(sketch.id);
  expect(resized.graph.entities).toEqual(human.graph.entities.map((entity: { id: string }) => entity.id === 'peer' ? { ...entity, radius: 12 } : entity));
  expect(resized.graph.relations).toEqual(human.graph.relations);
  expect(resized.graph.points.map((point: { id: string }) => point.id)).toEqual(human.graph.points.map((point: { id: string }) => point.id));
  for (const originalPoint of sketch.graph!.points) for (const [axis, value] of originalPoint.position.entries()) if (typeof value === 'string')
    expect(resized.graph.points.find((point: { id: string }) => point.id === originalPoint.id).position[axis]).toBe(value);
  for (const id of ['a', 'b', 'p', 'q']) {
    const point = resized.graph.points.find((point: { id: string }) => point.id === id);
    expect(Math.hypot(...point.position)).toBeCloseTo(12, 9);
  }
  expect(await readFeature(pad.id)).toEqual(repairedPad);
  const grown = await call(page, 'cad_build', { expectedVersion: current.version });
  expect(grown.diagnostics).toEqual([]); expect(grown.bodies[0]).toMatchObject({ solidCount: 1 }); expect(grown.bodies[0].volumeMm3).toBeGreaterThan(0);
  const section = await call(page, 'cad_inspect_section', { expectedVersion: current.version, section: { bodyId: pad.id, plane: 'XY', offset: 2.5 } });
  expect(section.contourCount).toBe(1); expect(section.entities.nextOffset).toBeNull();
  expect(section.entities.items.filter((entity: { type: string }) => entity.type === 'arc')).toHaveLength(2);
  for (const entity of section.entities.items) if (entity.type === 'arc') expect(entity.radius).toBeCloseTo(12, 9);
  await call(page, 'cad_history', { expectedVersion: current.version, direction: 'undo' }); current = await context(page);
  expect(current.parameters.stockRadius).toBe(10); expect(await readFeature(sketch.id)).toEqual(human); expect(await readFeature(pad.id)).toEqual(repairedPad);
  await call(page, 'cad_history', { expectedVersion: current.version, direction: 'redo' }); current = await context(page);
  expect(current.parameters.stockRadius).toBe(12); expect(await readFeature(sketch.id)).toEqual(resized);
  await call(page, 'cad_save_document', { expectedVersion: current.version }); await page.reload();
  await expect(page.getByRole('main', { name: 'Parametric CAD workbench' })).toBeVisible(); current = await context(page);
  expect(current.dirty).toBe(false); expect(current.parameters.stockRadius).toBe(12); expect(await readFeature(sketch.id)).toEqual(resized); expect(await readFeature(pad.id)).toEqual(repairedPad);
});
