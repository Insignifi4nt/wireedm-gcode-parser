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

/** Remove the one Symmetric the menu shows as applied to the selection, and give the sketch once it is gone. */
async function removeSymmetric(page: Page) {
  await page.getByRole('button', { name: 'Constrain', exact: true }).click();
  const item = page.getByRole('menu', { name: 'Constraint tools', exact: true }).getByRole('menuitemcheckbox', { name: 'Symmetric', exact: true });
  await expect(item).toBeChecked(); await item.click();
  // A version read just before the removal is accepted goes stale; such a read is retried, not failed.
  await expect.poll(async () => {
    const result = await rawCall(page, 'cad_get_feature', { expectedVersion: (await context(page)).version, featureId: 'axes' });
    return result.ok ? result.data.feature.graph.relations : 'stale';
  }).toEqual([]);
  await expect.poll(() => context(page)).toMatchObject({ workflowOpen: false });
}

test('mirrors two lines about the V axis with Symmetric, then removes it', async ({ page }) => {
  // B runs the other way from A, so its start lies nearest A's end's mirror.
  const sketch = await openSketch(page, {
    points: [{ id: 'a1', position: [10, 5] }, { id: 'a2', position: [25, 20] }, { id: 'b1', position: [-27, 22] }, { id: 'b2', position: [-11, 6] }],
    entities: [{ id: 'A', kind: 'line', construction: false, startPointId: 'a1', endPointId: 'a2' }, { id: 'B', kind: 'line', construction: false, startPointId: 'b1', endPointId: 'b2' }],
    relations: []
  });
  await sketch.clickAt(17.5, 12.5); await sketch.clickAt(-19, 14, true); await sketch.clickAt(0, 14, true);
  expect(await sketch.selection()).toEqual([{ kind: 'entity', id: 'A' }, { kind: 'entity', id: 'B' }, { kind: 'entity', id: '@v' }]);
  await sketch.constrain('Symmetric');
  const graph = await sketch.changed();
  expect(graph.relations).toMatchObject([{ kind: 'symmetric', curveIds: ['A', 'B'], lineId: '@v' }]);
  for (const [a, b] of [['a1', 'b2'], ['a2', 'b1']]) {
    const [p, q] = [sketch.position(graph, a), sketch.position(graph, b)];
    expect(p[0] + q[0]).toBeCloseTo(0, 9); expect(p[1]).toBeCloseTo(q[1], 9);
  }
  // Its marks sit on the two lines; the axis draws as before.
  await expect(page.locator(`[data-cad-sketch-relation-glyph="${(graph.relations[0] as { id: string }).id}"]`)).toHaveCount(2);
  // Picked again in another order on the solved lines, away from their marks at the middles, the mirror shows as applied.
  const along = (p: string, q: string) => [0, 1].map(index => .7 * sketch.position(graph, p)[index] + .3 * sketch.position(graph, q)[index]) as [number, number];
  await sketch.clickAt(...along('b1', 'b2')); await sketch.clickAt(0, 14, true); await sketch.clickAt(...along('a1', 'a2'), true);
  await removeSymmetric(page);
});

test('draws two horizontal lines and mirrors them about the V axis with Symmetric, keeping both Horizontal relations', async ({ page }) => {
  const sketch = await openSketch(page, { points: [], entities: [], relations: [] });
  const settled = async (version: string) => {
    await expect.poll(async () => (await context(page)).version).not.toBe(version);
    await expect.poll(() => context(page)).toMatchObject({ workflowOpen: false });
    return (await call(page, 'cad_get_feature', { expectedVersion: (await context(page)).version, featureId: 'axes' })).feature.graph as Graph;
  };
  // Each line drawn level is kept horizontal by the relation drawing creates; B lies higher and shorter than A's mirror image.
  await page.getByRole('button', { name: 'Line', exact: true }).click(); await expect(page.getByRole('checkbox', { name: 'Create relations', exact: true })).toBeChecked();
  let graph: Graph = { points: [], entities: [], relations: [] };
  const drawn: [[number, number], [number, number]][] = [[[10, 12], [28, 12]], [[-24, 16], [-12, 16]]];
  for (const [from, to] of drawn) {
    const version = (await context(page)).version;
    await sketch.clickAt(...from); await sketch.clickAt(...to); await page.keyboard.press('Escape');
    graph = await settled(version);
  }
  await page.keyboard.press('Escape');
  const lines = graph.entities as { id: string; startPointId: string; endPointId: string }[];
  expect(lines).toHaveLength(2);
  const horizontal = (graph.relations as { kind: string }[]).filter(relation => relation.kind === 'horizontal');
  expect(horizontal).toHaveLength(2);
  const [a, b] = lines, along = (line: typeof a) => [0, 1].map(index => .7 * sketch.position(graph, line.startPointId)[index] + .3 * sketch.position(graph, line.endPointId)[index]) as [number, number];
  await sketch.clickAt(...along(a)); await sketch.clickAt(...along(b), true); await sketch.clickAt(0, 30, true);
  expect(await sketch.selection()).toEqual([{ kind: 'entity', id: a.id }, { kind: 'entity', id: b.id }, { kind: 'entity', id: '@v' }]);
  const version = (await context(page)).version;
  await sketch.constrain('Symmetric');
  const mirrored = await settled(version);
  expect(mirrored.relations).toEqual([...graph.relations, { id: expect.any(String), kind: 'symmetric', curveIds: [a.id, b.id], lineId: '@v' }]);
  // B's ends land on A's mirrored ends, both lines stay level, and the sketch reports no redundancy.
  const ends = (line: typeof a) => [line.startPointId, line.endPointId].map(id => sketch.position(mirrored, id));
  const images = ends(a).map(([x, y]) => [-x, y]).sort((p, q) => p[0] - q[0]), targets = ends(b).sort((p, q) => p[0] - q[0]);
  for (const [index, [x, y]] of images.entries()) { expect(targets[index][0]).toBeCloseTo(x, 9); expect(targets[index][1]).toBeCloseTo(y, 9); }
  expect(targets[0][1]).toBeCloseTo(targets[1][1], 9);
  await expect(page.getByLabel('Sketch constraint status')).toHaveText('Under defined · 3 DOF');
});

test('mirrors two circles about a construction line with Symmetric, giving them one radius, then removes it', async ({ page }) => {
  const sketch = await openSketch(page, {
    points: [{ id: 'k1', position: [15, 8] }, { id: 'k2', position: [44, 9] }, { id: 'm1', position: [30, -6] }, { id: 'm2', position: [30, 24] }],
    entities: [{ id: 'A', kind: 'circle', construction: false, centerPointId: 'k1', radius: 4 }, { id: 'B', kind: 'circle', construction: false, centerPointId: 'k2', radius: 5 },
      { id: 'm', kind: 'line', construction: true, startPointId: 'm1', endPointId: 'm2' }], relations: []
  });
  await sketch.clickAt(30, 20); await sketch.clickAt(15, 12, true); await sketch.clickAt(49, 9, true);
  expect(await sketch.selection()).toEqual([{ kind: 'entity', id: 'm' }, { kind: 'entity', id: 'A' }, { kind: 'entity', id: 'B' }]);
  await sketch.constrain('Symmetric');
  const graph = await sketch.changed();
  expect(graph.relations).toMatchObject([{ kind: 'symmetric', curveIds: ['A', 'B'], lineId: 'm' }]);
  const radii = (graph.entities as { id: string; radius?: unknown }[]).filter(entity => entity.id !== 'm').map(entity => Number(entity.radius));
  expect(radii[0]).toBeCloseTo(radii[1], 9);
  // The centres reflect about the line wherever the solve leaves it: their middle lies on it and they join across it.
  const [k1, k2, m1, m2] = ['k1', 'k2', 'm1', 'm2'].map(id => sketch.position(graph, id));
  const along = [m2[0] - m1[0], m2[1] - m1[1]], middle = [(k1[0] + k2[0]) / 2 - m1[0], (k1[1] + k2[1]) / 2 - m1[1]];
  expect(along[0] * middle[1] - along[1] * middle[0]).toBeCloseTo(0, 6);
  expect(along[0] * (k2[0] - k1[0]) + along[1] * (k2[1] - k1[1])).toBeCloseTo(0, 6);
  // Its marks sit on both circles and on the mirror line. Picked again away from them, at the circles' sides, the mirror shows as applied.
  await expect(page.locator(`[data-cad-sketch-relation-glyph="${(graph.relations[0] as { id: string }).id}"]`)).toHaveCount(3);
  const [left, right] = [k1[0] - radii[0], k2[0] + radii[1]];
  await sketch.clickAt(right, k2[1]); await sketch.clickAt(left, k1[1], true); await sketch.clickAt(.7 * m1[0] + .3 * m2[0], .7 * m1[1] + .3 * m2[1], true);
  await removeSymmetric(page);
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
