import { expect, test } from './fixtures/native-sketch-solver';
import { prepareCadTools, callCadTool as call, cadContext as context, historyRow } from './cad-tool-helpers';

test('selects a dimension with a click, edits it on double-click and removes selected dimensions with Delete in one undo step', async ({ page }) => {
  await prepareCadTools(page); await call(page, 'cad_open_workspace');
  const sketch = { id: 'bracket', kind: 'sketch', name: 'Bracket', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: {
    points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [40, 0] }, { id: 'c', position: [40, 30] }],
    entities: [{ id: 'base', kind: 'line', startPointId: 'a', endPointId: 'b', construction: false }, { id: 'side', kind: 'line', startPointId: 'b', endPointId: 'c', construction: false }],
    relations: [{ id: 'length', kind: 'distance', pointIds: ['a', 'b'], value: 40 }, { id: 'rise', kind: 'axis-distance', pointIds: ['b', 'c'], axis: 'y', value: 30 },
      { id: 'run', kind: 'axis-distance', pointIds: ['a', 'c'], axis: 'x', value: 40 }] } };
  await call(page, 'cad_edit_document', { expectedVersion: (await context(page)).version, edits: [{ kind: 'add-feature', feature: sketch }] });
  await (await historyRow(page, 'Bracket')).dblclick();
  await expect(page.getByRole('button', { name: 'Finish sketch', exact: true })).toBeVisible();
  const label = (id: string) => page.locator(`[data-cad-sketch-dimension="${id}"] [role="button"]`);
  const status = page.locator('[data-cad-dimension-status]');

  // A click selects only: the measured line lights up and the editor stays closed.
  await label('length').click();
  await expect(label('length')).toHaveAttribute('aria-pressed', 'true');
  await expect(status).toHaveText('Length selected · Double-click or Enter edits · Delete removes');
  await expect(page.locator('[data-cad-highlight-entity="base"]')).toHaveCount(1);
  await expect(page.getByRole('textbox', { name: 'Length mm', exact: true })).toHaveCount(0);
  await label('length').dblclick();
  await expect(page.getByRole('textbox', { name: 'Length mm', exact: true })).toHaveValue('40');

  await label('rise').click(); await label('run').click({ modifiers: ['Shift'] });
  await expect(status).toHaveText('2 dimensions selected · Delete removes them');
  await page.keyboard.press('Delete');
  await expect(label('rise')).toHaveCount(0); await expect(label('run')).toHaveCount(0); await expect(label('length')).toHaveCount(1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(label('rise')).toHaveCount(1); await expect(label('run')).toHaveCount(1);

  // Right-click selects the dimension and offers the shared commands; unavailable ones say why.
  const box = await label('rise').boundingBox(); if (!box) throw new Error('Dimension label unavailable.');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
  await expect(label('rise')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('menuitem', { name: 'Make reference', exact: true })).toBeDisabled();
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  await expect(label('rise')).toHaveCount(0);
  await page.getByRole('button', { name: 'Finish sketch', exact: true }).click();
  await expect.poll(() => context(page)).toMatchObject({ workflowOpen: false });
  const current = await context(page);
  const finished = (await call(page, 'cad_get_feature', { expectedVersion: current.version, featureId: 'bracket' })).feature;
  expect(finished.graph.relations).toEqual([sketch.graph.relations[0], sketch.graph.relations[2]]);
});
