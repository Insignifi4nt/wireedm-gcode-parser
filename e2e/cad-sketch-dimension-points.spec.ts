import { expect, test } from '@playwright/test';
import { prepareCadTools, callCadTool as call, cadContext as context, historyRow } from './cad-tool-helpers';

test('positions a bore by Dimension-first point picks with private editing, exact Undo, agent parity and save/reopen', async ({ page }) => {
  await prepareCadTools(page); await call(page, 'cad_open_workspace');
  const sketch = { id: 'plate', kind: 'sketch', name: 'Located bore', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: {
    points: [{ id: 'a', position: [' 0.00 ', '0'] }, { id: 'b', position: ['50', '0'] }, { id: 'c', position: ['50', '40'] },
      { id: 'd', position: ['0', '40'] }, { id: 'o', position: [18, 12] }],
    entities: [{ id: 'ab', kind: 'line', startPointId: 'a', endPointId: 'b', construction: false }, { id: 'bc', kind: 'line', startPointId: 'b', endPointId: 'c', construction: false },
      { id: 'cd', kind: 'line', startPointId: 'c', endPointId: 'd', construction: false }, { id: 'da', kind: 'line', startPointId: 'd', endPointId: 'a', construction: false },
      { id: 'bore', kind: 'circle', centerPointId: 'o', radius: ' 4.00 ', construction: false }], relations: [] } };
  await call(page, 'cad_edit_document', { expectedVersion: (await context(page)).version, edits: [{ kind: 'add-feature', feature: sketch },
    { kind: 'add-feature', feature: { id: 'pad', kind: 'extrude', name: 'Thickness', suppressed: false, sketchId: 'plate', distance: ' 5e0 ', symmetric: false, operation: 'new', targetId: null } }] });
  const base = await context(page);
  const read = (version: string) => call(page, 'cad_get_feature', { expectedVersion: version, featureId: 'plate' }).then(r => r.feature);
  const edit = async () => { await (await historyRow(page, 'Located bore')).dblclick(); await expect(page.getByRole('button', { name: 'Cancel sketch edits', exact: true })).toBeVisible(); };
  const first = page.locator('[data-cad-sketch-point="a"]'), second = page.locator('[data-cad-sketch-point="o"]');
  const choosePair = async () => {
    await page.locator('[aria-label="Sketch drawing canvas"]').click({ position: { x: 10, y: 10 } });
    await page.getByRole('button', { name: 'Dimension', exact: true }).click(); await first.press('Enter'); await second.press('Enter');
  };
  const apply = async () => { await page.getByRole('button', { name: 'Apply', exact: true }).click(); await expect(page.getByRole('button', { name: 'Apply', exact: true })).toHaveCount(0); };
  const finish = async () => { await page.getByRole('button', { name: 'Finish sketch', exact: true }).click(); await expect(page.getByRole('button', { name: 'Finish sketch', exact: true })).toHaveCount(0); };
  await edit(); await page.getByRole('button', { name: 'Dimension', exact: true }).click(); await first.press('Enter');
  await first.press('Escape'); expect((await context(page)).version).toBe(base.version); expect(await read(base.version)).toEqual(sketch);
  await choosePair(); await page.getByRole('button', { name: 'Horizontal distance', exact: true }).click(); await page.getByRole('textbox', { name: 'Horizontal distance mm', exact: true }).fill('30'); await apply();
  await choosePair(); await page.getByRole('button', { name: 'Vertical distance', exact: true }).click(); await page.getByRole('textbox', { name: 'Vertical distance mm', exact: true }).fill('20'); await apply();
  expect(await read(base.version)).toEqual(sketch); await finish(); let current = await context(page); const human = await read(current.version);
  expect(human.graph).toEqual({ points: [...sketch.graph.points.slice(0, 4), { id: 'o', position: [30, 20] }], entities: sketch.graph.entities,
    relations: [{ id: expect.any(String), kind: 'axis-distance', axis: 'x', pointIds: ['a', 'o'], value: 30 },
      { id: expect.any(String), kind: 'axis-distance', axis: 'y', pointIds: ['a', 'o'], value: 20 }] });
  let built = await call(page, 'cad_build', { expectedVersion: current.version }); expect(built.diagnostics).toEqual([]);
  expect(built.bodies[0]).toMatchObject({ solidCount: 1, boundsMm: { min: [0, 0, 0], max: [50, 40, 5] } }); expect(built.bodies[0].volumeMm3).toBeCloseTo((2000 - 16 * Math.PI) * 5, 6);
  await edit(); await choosePair(); await page.getByRole('button', { name: 'Horizontal distance', exact: true }).click(); await page.getByRole('textbox', { name: 'Horizontal distance mm', exact: true }).fill('35'); await apply();
  await page.getByRole('button', { name: 'Cancel sketch edits', exact: true }).click(); await expect(page.getByRole('button', { name: 'Cancel sketch edits', exact: true })).toHaveCount(0);
  expect(await read(current.version)).toEqual(human);
  await call(page, 'cad_history', { expectedVersion: current.version, direction: 'undo' }); current = await context(page); expect(await read(current.version)).toEqual(sketch);
  await call(page, 'cad_edit_document', { expectedVersion: current.version, edits: human.graph.relations.map((relation: unknown) => ({ kind: 'set-sketch-relation', sketchId: 'plate', relation })) });
  current = await context(page); expect(await read(current.version)).toEqual(human);
  built = await call(page, 'cad_build', { expectedVersion: current.version }); expect(built.diagnostics).toEqual([]); expect(built.bodies[0].volumeMm3).toBeCloseTo((2000 - 16 * Math.PI) * 5, 6);
  await call(page, 'cad_save_document', { expectedVersion: current.version }); await page.reload(); await expect(page.getByRole('main', { name: 'Parametric CAD workbench' })).toBeVisible();
  current = await context(page); expect(current.dirty).toBe(false); expect(await read(current.version)).toEqual(human);
});
