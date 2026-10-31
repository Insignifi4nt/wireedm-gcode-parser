import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/native-sketch-solver';
import { prepareCadTools, callCadTool as call, rawCadToolCall as rawCall, cadContext as context } from './cad-tool-helpers';

type Graph = { points: { id: string; position: [number, number] }[]; entities: unknown[]; relations: unknown[] };

/** Open a sketch with this graph for editing, and give the screen position of a sketch position and the sketch as it is now. */
async function openSketch(page: Page, graph: Graph) {
  await prepareCadTools(page); await call(page, 'cad_open_workspace');
  const feature = { id: 'axes', kind: 'sketch', name: 'Axis sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph };
  await call(page, 'cad_edit_document', { expectedVersion: (await context(page)).version, edits: [{ kind: 'add-feature', feature }] });
  const before = await context(page);
  await expect.poll(() => rawCall(page, 'cad_get_viewport', { expectedVersion: before.version })).toMatchObject({ ok: true, data: { view: { available: true, referenceVersion: before.version } } });
  await call(page, 'cad_set_viewport', { expectedVersion: before.version, command: { kind: 'edit-sketch', sketchId: feature.id } });
  const canvas = page.getByLabel('Sketch drawing canvas');
  const project = async (x: number, y: number) => {
    const state = await call(page, 'cad_get_viewport', { expectedVersion: (await context(page)).version });
    const view = state.view as { centerMm: [number, number] };
    return canvas.evaluate((element, { x, y, center }) => {
      const matrix = (element as SVGSVGElement).getScreenCTM(); if (!matrix) throw new Error('Sketch projection unavailable.');
      const p = new DOMPoint(x - center[0], center[1] - y).matrixTransform(matrix); return { x: p.x, y: p.y };
    }, { x, y, center: view.centerMm });
  };
  /** Click a sketch position, adding to the selection with Shift. */
  const clickAt = async (x: number, y: number, add = false) => {
    const point = await project(x, y);
    if (add) await page.keyboard.down('Shift');
    await page.mouse.click(point.x, point.y);
    if (add) await page.keyboard.up('Shift');
  };
  const selection = async () => (await call(page, 'cad_get_viewport', { expectedVersion: (await context(page)).version })).selectedSketchGeometrySet;
  /** The sketch once the edit the last action started is accepted. */
  const changed = async () => {
    await expect.poll(async () => (await context(page)).version).not.toBe(before.version);
    await expect.poll(() => context(page)).toMatchObject({ workflowOpen: false });
    return (await call(page, 'cad_get_feature', { expectedVersion: (await context(page)).version, featureId: feature.id })).feature.graph as Graph;
  };
  const position = (graph: Graph, id: string) => graph.points.find(point => point.id === id)!.position.map(Number);
  const constrain = async (name: string) => {
    await page.getByRole('button', { name: 'Constrain', exact: true }).click();
    await page.getByRole('menu', { name: 'Constraint tools', exact: true }).getByRole('menuitemcheckbox', { name, exact: true }).click();
  };
  return { canvas, project, clickAt, selection, changed, position, constrain };
}
const fixed = (page: Page, id: '@origin' | '@h' | '@v') => page.locator(`[data-cad-sketch-fixed="${id}"]`);

test('selects the H axis far from the origin with a line and lays the line on it from the Constrain menu', async ({ page }) => {
  const sketch = await openSketch(page, {
    points: [{ id: 'a', position: [20, 10] }, { id: 'b', position: [40, 12] }],
    entities: [{ id: 'ab', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' }], relations: []
  });
  // The view fits the line, so the origin may be off screen; the H axis still crosses the whole view. Aim at it far from the
  // origin and its arrow, and well below the line.
  const frame = await sketch.canvas.boundingBox(), origin = await sketch.project(0, 0); if (!frame) throw new Error('Sketch canvas unavailable.');
  const axisX = frame.x + frame.width * 0.25, hAxis = fixed(page, '@h');
  expect(Math.abs(origin.x - axisX)).toBeGreaterThan(150);
  // A drag that starts on the axis boxes geometry as it would anywhere else; only a press released in place takes the axis.
  const onAxis = await sketch.project(30, 0), aboveLine = await sketch.project(25, 14);
  await page.mouse.move(onAxis.x, onAxis.y); await page.mouse.down(); await page.mouse.move(aboveLine.x, aboveLine.y, { steps: 6 }); await page.mouse.up();
  expect(await sketch.selection()).toEqual([{ kind: 'entity', id: 'ab' }]);
  await expect(hAxis).toHaveAttribute('aria-pressed', 'false');
  await page.mouse.move(axisX, origin.y + 2);
  await expect(hAxis).toHaveClass(/is-pick-highlighted/);
  await page.mouse.click(axisX, origin.y + 2);
  await expect(hAxis).toHaveAttribute('aria-pressed', 'true');
  // The axis is selected as an ordinary edge, beside the line.
  await sketch.clickAt(30, 11, true);
  expect(await sketch.selection()).toEqual([{ kind: 'entity', id: '@h' }, { kind: 'entity', id: 'ab' }]);
  await expect(hAxis).toHaveAttribute('aria-pressed', 'true');

  // The list shows what a line takes with an axis; Tangent and Equal need ends and a length an axis lacks, so they are unavailable.
  await page.getByRole('button', { name: 'Constrain', exact: true }).click();
  const menu = page.getByRole('menu', { name: 'Constraint tools', exact: true });
  await expect(menu.getByRole('menuitemcheckbox')).toHaveText(['Coincident', 'Parallel', 'Perpendicular', 'Tangent', 'Equal']);
  for (const name of ['Tangent', 'Equal']) await expect(menu.getByRole('menuitemcheckbox', { name, exact: true })).toBeDisabled();
  await menu.getByRole('menuitemcheckbox', { name: 'Coincident', exact: true }).click();
  const graph = await sketch.changed();
  expect(graph.relations).toMatchObject([{ kind: 'fixed-axis', pointId: 'a', axis: 'y', value: 0 }, { kind: 'fixed-axis', pointId: 'b', axis: 'y', value: 0 }]);
  // The solver moves the line onto the axis and keeps it spanning the same X range.
  for (const [index, x] of [20, 40].entries()) {
    const [px, py] = graph.points[index].position.map(Number);
    expect(px).toBeCloseTo(x, 6); expect(py).toBeCloseTo(0, 9);
  }
});

test('mirrors two points about the V axis with Symmetric', async ({ page }) => {
  const sketch = await openSketch(page, { points: [{ id: 'p', position: [-15, 22] }, { id: 'q', position: [12, 30] }], entities: [], relations: [] });
  await sketch.clickAt(-15, 22); await sketch.clickAt(12, 30, true); await sketch.clickAt(0, 26, true);
  expect(await sketch.selection()).toEqual([{ kind: 'point', id: 'p' }, { kind: 'point', id: 'q' }, { kind: 'entity', id: '@v' }]);
  await expect(fixed(page, '@v')).toHaveAttribute('aria-pressed', 'true');
  await sketch.constrain('Symmetric');
  const graph = await sketch.changed();
  expect(graph.relations).toMatchObject([{ kind: 'symmetric', pointIds: ['p', 'q'], lineId: '@v' }]);
  const [p, q] = [sketch.position(graph, 'p'), sketch.position(graph, 'q')];
  expect(p[0] + q[0]).toBeCloseTo(0, 9); expect(p[1]).toBeCloseTo(q[1], 9);
  // Its mark sits on the two points; the axis draws as before.
  await expect(page.locator(`[data-cad-sketch-relation-glyph="${(graph.relations[0] as { id: string }).id}"]`)).toHaveCount(2);
  await expect(fixed(page, '@v')).toHaveCount(1);
});

test('makes a line parallel to the H axis horizontal, and shows it as Horizontal', async ({ page }) => {
  const sketch = await openSketch(page, {
    points: [{ id: 'a', position: [20, 10] }, { id: 'b', position: [40, 16] }, { id: 'c', position: [-10, -12] }],
    entities: [{ id: 'ab', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' }], relations: []
  });
  await sketch.clickAt(30, 13); await sketch.clickAt(10, 0, true);
  expect(await sketch.selection()).toEqual([{ kind: 'entity', id: 'ab' }, { kind: 'entity', id: '@h' }]);
  await sketch.constrain('Parallel');
  const graph = await sketch.changed();
  expect(graph.relations).toMatchObject([{ kind: 'horizontal', pointIds: ['a', 'b'] }]);
  expect(sketch.position(graph, 'a')[1]).toBeCloseTo(sketch.position(graph, 'b')[1], 9);
  await expect(page.locator(`[data-cad-sketch-relation-glyph="${(graph.relations[0] as { id: string }).id}"]`)).toHaveAttribute('aria-label', /^Horizontal: /);
});

test('centres a circle on the origin with Concentric', async ({ page }) => {
  const sketch = await openSketch(page, {
    points: [{ id: 'k', position: [25, -18] }, { id: 'c', position: [-20, 15] }],
    entities: [{ id: 'ring', kind: 'circle', construction: false, centerPointId: 'k', radius: 4 }], relations: []
  });
  await sketch.clickAt(29, -18); await sketch.clickAt(0, 0, true);
  expect(await sketch.selection()).toEqual([{ kind: 'entity', id: 'ring' }, { kind: 'point', id: '@origin' }]);
  await expect(fixed(page, '@origin')).toHaveAttribute('aria-pressed', 'true');
  await sketch.constrain('Concentric');
  const graph = await sketch.changed();
  expect(graph.relations).toMatchObject([{ kind: 'fixed-axis', pointId: 'k', axis: 'x', value: 0 }, { kind: 'fixed-axis', pointId: 'k', axis: 'y', value: 0 }]);
  const [x, y] = sketch.position(graph, 'k'); expect(x).toBeCloseTo(0, 9); expect(y).toBeCloseTo(0, 9);
});

test('dimensions a point from the H axis as a Distance', async ({ page }) => {
  const sketch = await openSketch(page, { points: [{ id: 'p', position: [-15, 22] }, { id: 'q', position: [30, -10] }], entities: [], relations: [] });
  const tool = page.getByRole('button', { name: 'Dimension', exact: true });
  await tool.click(); await expect(tool).toHaveAttribute('aria-pressed', 'true');
  await sketch.clickAt(-15, 22); await sketch.clickAt(10, 0);
  await expect(fixed(page, '@h')).toHaveClass(/is-selected/);
  const point = await sketch.project(-5, 12); await page.mouse.move(point.x, point.y);
  await expect(page.locator('[data-cad-dimension-preview]')).toHaveAttribute('data-cad-dimension-preview', 'point-line');
  await expect(sketch.canvas).toHaveAccessibleDescription(/^Distance · Click or press Enter to place/);
  await page.mouse.click(point.x, point.y);
  const graph = await sketch.changed();
  expect(graph.relations).toMatchObject([{ kind: 'fixed-axis', pointId: 'p', axis: 'y', value: 22 }]);
  const id = (graph.relations[0] as { id: string }).id;
  await expect(page.locator(`[data-cad-sketch-dimension="${id}"] [role="button"]`)).toHaveAccessibleName('Dimension distance 22 mm, press Enter to edit');
});
