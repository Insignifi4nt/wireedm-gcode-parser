import { expect, test } from './fixtures/native-sketch-solver';
import type { CadSketchFeature } from '../src/domain/cad/cadDocument';
import { prepareCadTools, callCadTool as call, rawCadToolCall as raw, cadContext as context, historyRow } from './cad-tool-helpers';

const lensArea = (separation: number) => 50 * Math.acos(separation / 10) - separation * Math.sqrt(100 - separation ** 2) / 2;

test('chooses an intersecting circle lens deliberately and keeps its source intent through dimension changes and save', async ({ page }) => {
  await prepareCadTools(page); await call(page, 'cad_open_workspace');
  const sketch: CadSketchFeature = { id: 'overlap', kind: 'sketch', name: 'Overlapping circles', suppressed: false,
    plane: 'XY', offset: 0, profiles: [], graph: {
      points: [{ id: 'left-center', position: ['0.000', '0'] }, { id: 'right-center', position: [' separation ', '0.00'] }],
      entities: [{ id: 'left-circle', kind: 'circle', construction: false, centerPointId: 'left-center', radius: ' 5.000 ' },
        { id: 'right-circle', kind: 'circle', construction: false, centerPointId: 'right-center', radius: 5 }], relations: []
    } };
  await call(page, 'cad_edit_document', { expectedVersion: (await context(page)).version,
    edits: [{ kind: 'set-parameter', name: 'separation', value: 6 }, { kind: 'add-feature', feature: sketch }] });
  let current = await context(page);
  await expect.poll(() => raw(page, 'cad_get_viewport', { expectedVersion: current.version }))
    .toMatchObject({ ok: true, data: { view: { available: true, referenceVersion: current.version } } });
  await (await historyRow(page, 'Overlapping circles')).click();
  await expect(page.getByRole('button', { name: 'Pad / Pocket', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Pad / Pocket', exact: true }).click();
  await page.getByRole('textbox', { name: 'Length mm', exact: true }).fill('5');
  await expect(page.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Pick closed areas from model', exact: true }).click();
  const canvas = page.getByLabel('3D model canvas');
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('Intersecting area canvas unavailable.');
  // Symmetric source bounds put the lens center at the fitted canvas center.
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.getByRole('button', { name: 'Finish area selection', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Apply', exact: true })).toBeEnabled();
  expect((await call(page, 'cad_get_feature', { expectedVersion: current.version, featureId: sketch.id })).feature).toEqual(sketch);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect((await context(page)).version).toBe(current.version);
  await page.getByRole('button', { name: 'Pad / Pocket', exact: true }).click();
  await page.getByRole('textbox', { name: 'Length mm', exact: true }).fill('5');
  await page.getByRole('button', { name: 'Pick closed areas from model', exact: true }).click();
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.getByRole('button', { name: 'Finish area selection', exact: true }).click();
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect.poll(() => context(page)).toMatchObject({ workflowOpen: false, featureCount: 2 });
  current = await context(page);
  const features = await call(page, 'cad_read_features', { expectedVersion: current.version });
  const pad = features.items[1];
  expect(pad.regionSelection).toMatchObject({ kind: 'graph-cells', cells: expect.any(Array) });
  expect((await call(page, 'cad_build', { expectedVersion: current.version })).bodies[0].volumeMm3).toBeCloseTo(lensArea(6) * 5, 7);
  await call(page, 'cad_history', { expectedVersion: current.version, direction: 'undo' }); current = await context(page);
  expect(current.featureCount).toBe(1);
  const areas = await call(page, 'cad_inspect_sketch_regions', { expectedVersion: current.version, sketchId: sketch.id, mode: 'graph-cells' });
  const lens = (areas.items as { cellId: number; areaMm2: number }[]).find(item => Math.abs(item.areaMm2 - lensArea(6)) < 1e-9);
  if (!lens) throw new Error('Agent lens receipt missing.');
  let referenceText = '', offset = 0;
  for (;;) {
    const chunk = await call(page, 'cad_read_sketch_region_reference', { expectedVersion: current.version, sketchId: sketch.id, cellIds: [lens.cellId], offset, length: 4096 });
    referenceText += chunk.text;
    if (chunk.nextOffset === null) break;
    expect(chunk.nextOffset).toBeGreaterThan(offset); offset = chunk.nextOffset;
  }
  const regionSelection: unknown = JSON.parse(referenceText);
  expect(regionSelection).toEqual(pad.regionSelection);
  await call(page, 'cad_edit_document', { expectedVersion: current.version, edits: [{ kind: 'add-feature', feature: { ...pad, regionSelection } }] });
  current = await context(page);
  expect((await call(page, 'cad_get_feature', { expectedVersion: current.version, featureId: pad.id })).feature).toEqual(pad);
  await call(page, 'cad_edit_document', { expectedVersion: current.version, edits: [{ kind: 'set-parameter', name: 'separation', value: 7 }] });
  current = await context(page);
  expect((await call(page, 'cad_get_feature', { expectedVersion: current.version, featureId: sketch.id })).feature).toEqual(sketch);
  expect((await call(page, 'cad_get_feature', { expectedVersion: current.version, featureId: pad.id })).feature).toEqual(pad);
  expect((await call(page, 'cad_build', { expectedVersion: current.version })).bodies[0].volumeMm3).toBeCloseTo(lensArea(7) * 5, 7);
  expect((await raw(page, 'cad_edit_document', { expectedVersion: current.version, edits: [{ kind: 'set-parameter', name: 'separation', value: 11 }] })).ok).toBe(false);
  expect((await context(page)).version).toBe(current.version);
  await call(page, 'cad_save_document', { expectedVersion: current.version }); await page.reload();
  await expect(page.getByRole('main', { name: 'Parametric CAD workbench' })).toBeVisible(); current = await context(page);
  expect(current.dirty).toBe(false);
  expect((await call(page, 'cad_get_feature', { expectedVersion: current.version, featureId: sketch.id })).feature).toEqual(sketch);
  expect((await call(page, 'cad_get_feature', { expectedVersion: current.version, featureId: pad.id })).feature).toEqual(pad);
  expect((await call(page, 'cad_build', { expectedVersion: current.version })).bodies[0].volumeMm3).toBeCloseTo(lensArea(7) * 5, 7);
});
