import { expect, test } from './fixtures/native-sketch-solver';
import { prepareCadTools, callCadTool as call, rawCadToolCall as rawCall, cadContext as context } from './cad-tool-helpers';

test('selects the H axis far from the origin with a line and lays the line on it from the Constrain menu', async ({ page }) => {
  await prepareCadTools(page); await call(page, 'cad_open_workspace');
  const feature = { id: 'axes', kind: 'sketch', name: 'Axis sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: {
    points: [{ id: 'a', position: [20, 10] }, { id: 'b', position: [40, 12] }],
    entities: [{ id: 'ab', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' }], relations: []
  } };
  await call(page, 'cad_edit_document', { expectedVersion: (await context(page)).version, edits: [{ kind: 'add-feature', feature }] });
  const before = await context(page);
  await expect.poll(() => rawCall(page, 'cad_get_viewport', { expectedVersion: before.version })).toMatchObject({ ok: true, data: { view: { available: true, referenceVersion: before.version } } });
  await call(page, 'cad_set_viewport', { expectedVersion: before.version, command: { kind: 'edit-sketch', sketchId: feature.id } });
  const canvas = page.getByLabel('Sketch drawing canvas');
  const project = async (x: number, y: number) => {
    const state = await call(page, 'cad_get_viewport', { expectedVersion: before.version });
    const view = state.view as { centerMm: [number, number] };
    return canvas.evaluate((element, { x, y, center }) => {
      const matrix = (element as SVGSVGElement).getScreenCTM(); if (!matrix) throw new Error('Sketch projection unavailable.');
      const p = new DOMPoint(x - center[0], center[1] - y).matrixTransform(matrix); return { x: p.x, y: p.y };
    }, { x, y, center: view.centerMm });
  };
  // The view fits the line, so the origin may be off screen; the H axis still crosses the whole view. Aim at it far from the
  // origin and its arrow, and well below the line.
  const frame = await canvas.boundingBox(), origin = await project(0, 0); if (!frame) throw new Error('Sketch canvas unavailable.');
  const axisX = frame.x + frame.width * 0.25, xAxis = page.locator('[data-cad-sketch-datum="x-axis"]');
  expect(Math.abs(origin.x - axisX)).toBeGreaterThan(150);
  // A drag that starts on the axis boxes geometry as it would anywhere else; only a press released in place takes the axis.
  const onAxis = await project(30, 0), aboveLine = await project(25, 14);
  await page.mouse.move(onAxis.x, onAxis.y); await page.mouse.down(); await page.mouse.move(aboveLine.x, aboveLine.y, { steps: 6 }); await page.mouse.up();
  expect((await call(page, 'cad_get_viewport', { expectedVersion: before.version })).selectedSketchGeometrySet).toEqual([{ kind: 'entity', id: 'ab' }]);
  await expect(xAxis).toHaveAttribute('aria-pressed', 'false');
  await page.mouse.move(axisX, origin.y + 2);
  await expect(xAxis).toHaveClass(/is-pick-highlighted/);
  await page.mouse.click(axisX, origin.y + 2);
  await expect(xAxis).toHaveAttribute('aria-pressed', 'true');
  const middle = await project(30, 11);
  await page.keyboard.down('Shift'); await page.mouse.click(middle.x, middle.y); await page.keyboard.up('Shift');
  expect((await call(page, 'cad_get_viewport', { expectedVersion: before.version })).selectedSketchGeometrySet).toEqual([{ kind: 'entity', id: 'ab' }]);
  await expect(xAxis).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: 'Constrain', exact: true }).click();
  const menu = page.getByRole('menu', { name: 'Constraint tools', exact: true });
  await expect(menu.getByRole('menuitemcheckbox')).toHaveText(['Coincident', 'Parallel', 'Perpendicular']);
  await menu.getByRole('menuitemcheckbox', { name: 'Coincident', exact: true }).click();
  await expect.poll(async () => (await context(page)).version).not.toBe(before.version);
  const graph = (await call(page, 'cad_get_feature', { expectedVersion: (await context(page)).version, featureId: feature.id })).feature.graph;
  expect(graph.relations).toMatchObject([{ kind: 'fixed-axis', pointId: 'a', axis: 'y', value: 0 }, { kind: 'fixed-axis', pointId: 'b', axis: 'y', value: 0 }]);
  // The solver moves the line onto the axis and keeps it spanning the same X range.
  for (const [index, x] of [20, 40].entries()) {
    const [px, py] = graph.points[index].position.map(Number);
    expect(px).toBeCloseTo(x, 6); expect(py).toBeCloseTo(0, 9);
  }
});
