import { expect, test } from './fixtures/native-sketch-solver';
import type { CadSketchFeature } from '../src/domain/cad/cadDocument';
import { prepareCadTools, callCadTool as call, cadContext as context, historyRow } from './cad-tool-helpers';

test('uses graph context Dimension and selected-set Move privately through a complete bored plate', async ({ page }) => {
  await prepareCadTools(page);
  await call(page, 'cad_open_workspace');
  const sketch: CadSketchFeature = {
    id: 'plate', kind: 'sketch', name: 'Bored plate', suppressed: false,
    plane: 'XY', offset: 0, profiles: [],
    graph: {
      points: [
        { id: 'p0', position: ['0', '0'] }, { id: 'p1', position: ['50', '0'] },
        { id: 'p2', position: ['50', '20'] }, { id: 'p3', position: ['0', '20'] },
        { id: 'center', position: [15, 10] }, { id: 'second-center', position: [35, 10] },
      ],
      entities: [
        ...[0, 1, 2, 3].map(i => ({
          id: `edge${i}`, kind: 'line' as const,
          startPointId: `p${i}`, endPointId: `p${(i + 1) % 4}`, construction: false,
        })),
        { id: 'hole', kind: 'circle', centerPointId: 'center', radius: 3, construction: false },
        { id: 'second', kind: 'circle', centerPointId: 'second-center', radius: 2, construction: false },
      ],
      relations: [],
    },
  };
  await call(page, 'cad_edit_document', {
    expectedVersion: (await context(page)).version,
    edits: [
      { kind: 'add-feature', feature: sketch },
      { kind: 'add-feature', feature: {
        id: 'pad', kind: 'extrude', name: 'Thickness', suppressed: false,
        sketchId: 'plate', distance: 5, symmetric: false, operation: 'new', targetId: null,
      } },
    ],
  });
  let current = await context(page);
  const base = current;
  const read = () => call(page, 'cad_get_feature', {
    expectedVersion: current.version, featureId: 'plate',
  }).then(result => result.feature);
  await (await historyRow(page, 'Bored plate')).dblclick();
  await expect(page.getByRole('button', { name: 'Cancel sketch edits', exact: true })).toBeVisible();
  const hole = page.locator('[data-cad-sketch-entity="hole"]');
  const second = page.locator('[data-cad-sketch-entity="second"]');
  await hole.press('Enter');
  await hole.press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Dimension', exact: true }).press('Escape');
  await expect(hole).toBeFocused();
  expect(await read()).toEqual(sketch);

  const canvas = page.locator('[aria-label="Sketch drawing canvas"]');
  // The menu's Dimension starts the tool with the hole picked; Enter places its diameter at the measured size, or selects the one
  // already there, and Enter again opens its editor.
  const dimension = async () => {
    await hole.press('Shift+F10');
    await page.getByRole('menuitem', { name: 'Dimension', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Dimension', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await canvas.press('Enter');
    await expect(page.locator('[data-cad-sketch-dimension] [role="button"][aria-pressed="true"]')).toHaveCount(1);
    await canvas.press('Enter');
    await expect(page.getByRole('textbox', { name: 'Diameter mm', exact: true })).toBeVisible();
  };
  await dimension();
  await page.getByRole('textbox', { name: 'Diameter mm', exact: true }).fill('0');
  await expect(page.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await read()).toEqual(sketch);
  await dimension();
  await page.getByRole('textbox', { name: 'Diameter mm', exact: true }).fill('8');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Apply', exact: true })).toHaveCount(0);

  await hole.press('Enter');
  await second.press('Shift+Enter');
  const move = async () => {
    await hole.press('Shift+F10');
    await page.getByRole('menuitem', { name: 'Move selection', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Move X', exact: true })).toBeVisible();
    await page.getByRole('textbox', { name: 'Move X', exact: true }).fill('5');
  };
  await move();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await read()).toEqual(sketch);
  await move();
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Apply', exact: true })).toHaveCount(0);
  expect(await read()).toEqual(sketch);
  expect((await context(page)).version).toBe(base.version);

  await page.getByRole('button', { name: 'Finish sketch', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Finish sketch', exact: true })).toHaveCount(0);
  current = await context(page);
  const final = await read();
  const owner = final.graph.relations[0];
  expect(final.graph.points).toEqual([
    ...sketch.graph!.points.slice(0, 4),
    { id: 'center', position: [20, 10] }, { id: 'second-center', position: [40, 10] },
  ]);
  expect(final.graph.entities).toEqual(sketch.graph!.entities.map(entity =>
    entity.id === 'hole' ? { ...entity, radius: 4 } : entity));
  expect(final.graph.relations).toEqual([
    { id: expect.any(String), kind: 'radial-size', entityId: 'hole', quantity: 'diameter', value: 8 },
  ]);
  const built = await call(page, 'cad_build', { expectedVersion: current.version });
  expect(built.diagnostics).toEqual([]);
  expect(built.bodies).toHaveLength(1);
  expect(built.bodies[0]).toMatchObject({ solidCount: 1, boundsMm: { min: [0, 0, 0], max: [50, 20, 5] } });
  expect(built.bodies[0].volumeMm3).toBeCloseTo(5000 - 100 * Math.PI, 7);

  await call(page, 'cad_history', { expectedVersion: current.version, direction: 'undo' });
  current = await context(page);
  expect(await read()).toEqual(sketch);
  await call(page, 'cad_history', { expectedVersion: current.version, direction: 'redo' });
  current = await context(page);
  expect(await read()).toEqual(final);
  await call(page, 'cad_history', { expectedVersion: current.version, direction: 'undo' });
  current = await context(page);
  await call(page, 'cad_edit_document', {
    expectedVersion: current.version,
    edits: [
      { kind: 'set-sketch-relation', sketchId: 'plate', relation: owner },
      { kind: 'translate-sketch-geometry', sketchId: 'plate',
        selections: [{ kind: 'entity', id: 'hole' }, { kind: 'entity', id: 'second' }], translation: [5, 0] },
    ],
  });
  current = await context(page);
  expect(await read()).toEqual(final);
  await call(page, 'cad_save_document', { expectedVersion: current.version });
  await page.reload();
  await expect(page.getByRole('main', { name: 'Parametric CAD workbench' })).toBeVisible();
  current = await context(page);
  expect(current.dirty).toBe(false);
  expect(await read()).toEqual(final);
});
