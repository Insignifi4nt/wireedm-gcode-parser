import { expect, test } from './fixtures/native-sketch-solver';
import { prepareCadTools, callCadTool as call, rawCadToolCall as rawCall, cadContext as context, enableGridSnap } from './cad-tool-helpers';

type Point = { id: string; position: [number, number] };
type Line = { id: string; kind: string; startPointId: string; endPointId: string };

test('dimensions a rectangle side from the Y axis in either pick order as a plain Distance, and explains a side across the axis', async ({ page }) => {
  await prepareCadTools(page); await call(page, 'cad_open_workspace');
  const sketch = { id: 'plate', kind: 'sketch', name: 'Axis plate', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: { points: [], entities: [], relations: [] } };
  await call(page, 'cad_edit_document', { expectedVersion: (await context(page)).version, edits: [{ kind: 'add-feature', feature: sketch }] });
  const initial = await context(page);
  await expect.poll(() => rawCall(page, 'cad_get_viewport', { expectedVersion: initial.version })).toMatchObject({ ok: true, data: { view: { available: true, referenceVersion: initial.version } } });
  await call(page, 'cad_set_viewport', { expectedVersion: initial.version, command: { kind: 'edit-sketch', sketchId: sketch.id } });
  await enableGridSnap(page);

  const canvas = page.getByLabel('Sketch drawing canvas'), tool = page.getByRole('button', { name: 'Dimension', exact: true });
  const preview = page.locator('[data-cad-dimension-preview]'), yAxis = page.locator('[data-cad-sketch-datum="y-axis"]');
  const project = async (x: number, y: number) => {
    const current = await context(page), center = (await call(page, 'cad_get_viewport', { expectedVersion: current.version })).view.centerMm as [number, number];
    return canvas.evaluate((element, { x, y, center }) => {
      const matrix = (element as SVGSVGElement).getScreenCTM(); if (!matrix) throw new Error('Sketch projection unavailable.');
      const point = new DOMPoint(x - center[0], center[1] - y).matrixTransform(matrix); return { x: point.x, y: point.y };
    }, { x, y, center });
  };
  const hover = async (x: number, y: number) => { const point = await project(x, y); await page.mouse.move(point.x, point.y); };
  const clickAt = async (x: number, y: number) => { const point = await project(x, y); await page.mouse.click(point.x, point.y); };
  const settled = async () => {
    await expect.poll(() => context(page)).toMatchObject({ workflowOpen: false }); const current = await context(page);
    const graph = (await call(page, 'cad_get_feature', { expectedVersion: current.version, featureId: sketch.id })).feature.graph;
    return { version: current.version, points: graph.points as Point[], entities: graph.entities as Line[], relations: graph.relations as unknown[] };
  };
  const startDimension = async () => { if (await tool.getAttribute('aria-pressed') !== 'true') await tool.click(); await expect(tool).toHaveAttribute('aria-pressed', 'true'); };

  // A rectangle drawn across the Y axis, its sides kept level and upright by the relations Rectangle creates.
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await clickAt(-20, 10); await clickAt(30, 40);
  await expect.poll(async () => (await settled()).entities.length).toBe(4);
  const drawn = await settled(), at = (id: string) => drawn.points.find(point => point.id === id)!.position;
  const side = (test: (a: [number, number], b: [number, number]) => boolean) => drawn.entities.find(line => test(at(line.startPointId), at(line.endPointId)))!;
  const right = side((a, b) => a[0] === 30 && b[0] === 30), top = side((a, b) => a[1] === 40 && b[1] === 40);
  expect(drawn.relations).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'vertical' }), expect.objectContaining({ kind: 'horizontal' })]));
  // Rectangle stays active and leaves nothing selected, so Dimension chosen straight after it starts with no pick.
  expect((await call(page, 'cad_get_viewport', { expectedVersion: drawn.version })).selectedSketchGeometrySet).toEqual([]);
  await expect(page.getByRole('button', { name: 'Rectangle', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const view = async () => (await call(page, 'cad_get_viewport', { expectedVersion: (await context(page)).version })).view;
  expect(await view()).toMatchObject({ onPartDimensionsVisible: false });
  const distance = { id: expect.any(String), kind: 'fixed-axis', pointId: right.startPointId, axis: 'x', value: 30 };
  const label = (relations: unknown[]) => page.locator(`[data-cad-sketch-dimension="${(relations.at(-1) as { id: string }).id}"] [role="button"]`);

  // Dimension, the Y axis, then the right side: the preview shows the distance, a click places it, it draws, and a double-click edits it as Distance.
  await startDimension(); await clickAt(0, 25);
  await expect(canvas).toHaveAccessibleDescription(/^Dimension · Choose a point, an arc, a circle or a line to dimension from the Y axis/);
  await clickAt(30, 25); await hover(42, 30);
  await expect(preview).toHaveAttribute('data-cad-dimension-preview', 'datum'); await expect(preview).toContainText('30 mm');
  await expect(canvas).toHaveAccessibleDescription(/^Distance · Click or press Enter to place/);
  await clickAt(42, 30);
  await expect.poll(async () => (await settled()).relations.length).toBe(drawn.relations.length + 1);
  const placed = await settled(); expect(placed.relations).toEqual([...drawn.relations, distance]);
  await expect(label(placed.relations)).toHaveAccessibleName('Dimension distance 30 mm, press Enter to edit');
  await expect(label(placed.relations)).toHaveAttribute('aria-pressed', 'true');
  // The viewport reports the drawn distance, the sketch's only dimension.
  expect(await view()).toMatchObject({ onPartDimensionsVisible: true });
  await label(placed.relations).dblclick();
  const value = page.getByRole('textbox', { name: 'Distance mm', exact: true });
  await expect(value).toHaveValue('30'); await value.fill('35'); await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect.poll(async () => (await settled()).relations.at(-1)).toEqual({ ...distance, value: 35 });
  const resized = await settled();
  for (const id of [right.startPointId, right.endPointId]) expect(resized.points.find(point => point.id === id)!.position[0]).toBeCloseTo(35, 9);
  await expect(label(resized.relations)).toHaveAccessibleName('Dimension distance 35 mm, press Enter to edit');
  for (let step = 0; step < 2; step++) { await canvas.focus(); await page.keyboard.press('Control+z'); }
  await expect.poll(async () => (await settled()).relations).toEqual(drawn.relations);

  // The right side first, then the Y axis, places the same distance.
  await startDimension(); await clickAt(30, 25); await clickAt(0, 25); await hover(42, 30);
  await expect(preview).toHaveAttribute('data-cad-dimension-preview', 'datum');
  await expect(canvas).toHaveAccessibleDescription(/^Distance · Click or press Enter to place/);
  await clickAt(42, 30);
  await expect.poll(async () => (await settled()).relations.length).toBe(drawn.relations.length + 1);
  const again = await settled(); expect(again.relations).toEqual([...drawn.relations, distance]);
  // The editor shows Cancel once a value changes; cancelling keeps the placed distance.
  await label(again.relations).dblclick(); await expect(value).toHaveValue('30'); await value.fill('31');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect((await settled()).relations).toEqual([...drawn.relations, distance]); expect((await context(page)).version).toBe(again.version);

  // The top side runs across the Y axis, so it has no distance from it: the reason shows, and the picks stay for another choice.
  const refused = /^Dimension · This line is not parallel to the Y axis, so it has no distance from it\./;
  await startDimension(); await clickAt(10, 40); await clickAt(0, 25);
  await expect(canvas).toHaveAccessibleDescription(refused); await expect(preview).toHaveCount(0);
  await expect(yAxis).toHaveClass(/is-selected/);
  expect((await call(page, 'cad_get_viewport', { expectedVersion: again.version })).selectedSketchGeometrySet).toEqual([{ kind: 'entity', id: top.id }]);
  // Enter cannot place it either; the status message, named for the part, gives the same reason.
  await canvas.focus(); await page.keyboard.press('Enter');
  await expect(page.getByText(/: This line is not parallel to the Y axis, so it has no distance from it\.$/).first()).toBeVisible();
  await expect(canvas).toHaveAccessibleDescription(refused); await expect(yAxis).toHaveClass(/is-selected/);
  expect((await context(page)).version).toBe(again.version);
});
