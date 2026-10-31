import type { Locator } from '@playwright/test';
import { expect, test } from './fixtures/native-sketch-solver';
import { prepareCadTools, callCadTool as call, rawCadToolCall as rawCall, cadContext as context, enableGridSnap } from './cad-tool-helpers';

type Point = { id: string; position: [number, number] };
type Line = { id: string; kind: string; startPointId: string; endPointId: string };
type Relation = { id: string; kind: string; pointId?: string; lineId?: string; annotation?: Record<string, number | string> };
type Screen = { x: number; y: number };

test('places a dimension where it is clicked, moves it by its label and line, keeps it through undo and reload, and turns angle and radius labels', async ({ page }) => {
  await prepareCadTools(page); await call(page, 'cad_open_workspace');
  const sketch = { id: 'plate', kind: 'sketch', name: 'Placed plate', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: { points: [], entities: [], relations: [] } };
  await call(page, 'cad_edit_document', { expectedVersion: (await context(page)).version, edits: [{ kind: 'add-feature', feature: sketch }] });
  const editSketch = async () => {
    const current = await context(page);
    await expect.poll(() => rawCall(page, 'cad_get_viewport', { expectedVersion: current.version })).toMatchObject({ ok: true, data: { view: { available: true, referenceVersion: current.version } } });
    await call(page, 'cad_set_viewport', { expectedVersion: current.version, command: { kind: 'edit-sketch', sketchId: sketch.id } });
  };
  await editSketch(); await enableGridSnap(page);

  const canvas = page.getByLabel('Sketch drawing canvas'), tool = page.getByRole('button', { name: 'Dimension', exact: true });
  const preview = page.locator('[data-cad-dimension-preview]');
  const centerMm = async () => (await call(page, 'cad_get_viewport', { expectedVersion: (await context(page)).version })).view.centerMm as [number, number];
  const project = async (x: number, y: number): Promise<Screen> => {
    const center = await centerMm();
    return canvas.evaluate((element, { x, y, center }) => {
      const matrix = (element as SVGSVGElement).getScreenCTM(); if (!matrix) throw new Error('Sketch projection unavailable.');
      const point = new DOMPoint(x - center[0], center[1] - y).matrixTransform(matrix); return { x: point.x, y: point.y };
    }, { x, y, center });
  };
  const sketchAt = async (screen: Screen) => {
    const center = await centerMm();
    return canvas.evaluate((element, { screen, center }) => {
      const matrix = (element as SVGSVGElement).getScreenCTM(); if (!matrix) throw new Error('Sketch projection unavailable.');
      const point = new DOMPoint(screen.x, screen.y).matrixTransform(matrix.inverse()); return { x: point.x + center[0], y: center[1] - point.y };
    }, { screen, center });
  };
  const mmPerPixel = async () => { const [a, b] = [await project(0, 0), await project(10, 0)]; return 10 / (b.x - a.x); };
  const hover = async (x: number, y: number) => { const point = await project(x, y); await page.mouse.move(point.x, point.y); };
  const clickAt = async (x: number, y: number) => { const point = await project(x, y); await page.mouse.click(point.x, point.y); };
  const middle = async (locator: Locator): Promise<Screen> => {
    const box = await locator.boundingBox(); if (!box) throw new Error('Element not drawn.'); return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  const near = (actual: Screen, expected: Screen, pixels = 2) => {
    expect(Math.abs(actual.x - expected.x), `x ${actual.x} near ${expected.x}`).toBeLessThan(pixels);
    expect(Math.abs(actual.y - expected.y), `y ${actual.y} near ${expected.y}`).toBeLessThan(pixels);
  };
  const settled = async () => {
    await expect.poll(() => context(page)).toMatchObject({ workflowOpen: false }); const current = await context(page);
    const graph = (await call(page, 'cad_get_feature', { expectedVersion: current.version, featureId: sketch.id })).feature.graph;
    return { version: current.version, points: graph.points as Point[], entities: graph.entities as Line[], relations: graph.relations as Relation[] };
  };
  const label = (id: string) => page.locator(`[data-cad-sketch-dimension="${id}"] [role="button"]`);
  const moving = (id: string) => page.locator(`[data-cad-sketch-dimension-moving="${id}"]`);
  /** Presses at `from`, moves to `to` in steps, checks that only the moving overlay changed while the button is down, then releases and waits for the one edit. */
  const drag = async (id: string, from: Screen, to: Screen) => {
    const before = await settled();
    await page.mouse.move(from.x, from.y); await page.mouse.down();
    for (let step = 1; step <= 8; step++) await page.mouse.move(from.x + (to.x - from.x) * step / 8, from.y + (to.y - from.y) * step / 8);
    await expect(moving(id)).toHaveCount(1); expect((await context(page)).version).toBe(before.version);
    await page.mouse.up(); await expect(moving(id)).toHaveCount(0);
    await expect.poll(async () => (await context(page)).version).not.toBe(before.version);
    const after = await settled();
    // Moving a dimension changes where it is drawn, nothing else.
    expect(after.points).toEqual(before.points); expect(after.entities).toEqual(before.entities);
    const unplaced = (relations: Relation[]) => relations.map(relation => ({ ...relation, annotation: undefined }));
    expect(unplaced(after.relations)).toEqual(unplaced(before.relations));
    return after.relations.find(relation => relation.id === id)!;
  };

  // A rectangle, its sides kept level and upright by the relations Rectangle creates.
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await clickAt(0, 0); await clickAt(40, 20);
  await expect.poll(async () => (await settled()).entities.length).toBe(4);
  const drawn = await settled(), at = (id: string) => drawn.points.find(point => point.id === id)!.position;
  const side = (y: number) => drawn.entities.find(line => at(line.startPointId)[1] === y && at(line.endPointId)[1] === y)!;
  const bottom = side(0), top = side(20), along = Math.sign(at(bottom.endPointId)[0] - at(bottom.startPointId)[0]);

  // Dimension the two parallel sides. The preview draws the distance through the pointer, and the click places it exactly there.
  await tool.click(); await clickAt(20, 0); await clickAt(20, 20); await hover(55, 10);
  await expect(preview).toHaveAttribute('data-cad-dimension-preview', 'point-line');
  const previewed = await middle(preview.locator('.cad-sketch-graph-dimension-text').first());
  await clickAt(55, 10);
  await expect.poll(async () => (await settled()).relations.length).toBe(drawn.relations.length + 1);
  const placed = await settled(), gap = placed.relations.at(-1)!;
  expect(placed.relations).toEqual([...drawn.relations, { id: expect.any(String), kind: 'point-line-distance', pointId: expect.any(String), lineId: bottom.id, side: expect.any(String), value: 20,
    annotation: { kind: 'linear', offset: expect.any(Number), along: 0.5 } }]);
  expect([top.startPointId, top.endPointId]).toContain(gap.pointId);
  // The offset slides the dimension line along the bottom side from the foot of the measured point to the click.
  let scale = await mmPerPixel();
  expect(Math.abs(Number(gap.annotation!.offset) - (55 - at(gap.pointId!)[0]) * along)).toBeLessThan(2 * scale);
  near(await middle(page.locator(`[data-cad-sketch-dimension="${gap.id}"] .cad-sketch-graph-dimension-text`)), previewed, 1.5);
  const line = page.locator(`[data-cad-sketch-dimension="${gap.id}"] .cad-sketch-graph-dimension-line`).first();
  expect(Math.abs((await middle(line)).x - (await project(55, 10)).x)).toBeLessThan(2);

  // In Select, dragging the value moves it along the dimension line and slides the line along the side, while only the dragged dimension
  // draws again; the release is one edit that changes nothing but the placement.
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  const grabbed = await middle(label(gap.id)), dropped = { x: grabbed.x + 36, y: grabbed.y - 48 };
  const labelled = await drag(gap.id, grabbed, dropped);
  expect(labelled.annotation).toEqual({ kind: 'linear', offset: expect.any(Number), along: expect.any(Number) });
  expect(Math.abs(Number(labelled.annotation!.offset) - Number(gap.annotation!.offset) - 36 * scale * along)).toBeLessThan(2 * scale);
  expect(Math.abs(Number(labelled.annotation!.along) - 0.5 - 48 * scale / 20)).toBeLessThan(2 * scale / 20);
  near(await middle(label(gap.id)), dropped);
  await expect(label(gap.id)).toHaveAttribute('aria-pressed', 'true');

  // Dragging the line itself only slides it: the text keeps its place along the line and moves with it.
  const lineX = at(gap.pointId!)[0] + Number(labelled.annotation!.offset) * along, held = await middle(label(gap.id));
  const pressed = await project(lineX, 3), released = { x: pressed.x - 24, y: pressed.y + 30 };
  const slid = await drag(gap.id, pressed, released);
  expect(slid.annotation!.along).toBe(labelled.annotation!.along);
  expect(Math.abs(Number(slid.annotation!.offset) - Number(labelled.annotation!.offset) + 24 * scale * along)).toBeLessThan(2 * scale);
  near(await middle(label(gap.id)), { x: held.x - 24, y: held.y });

  // Each move is one undo step, and redo puts them back.
  const placementOf = async () => (await settled()).relations.find(relation => relation.id === gap.id)!.annotation;
  await canvas.focus(); await page.keyboard.press('Control+z'); await expect.poll(placementOf).toEqual(labelled.annotation);
  await page.keyboard.press('Control+z'); await expect.poll(placementOf).toEqual(gap.annotation);
  await page.keyboard.press('Control+Shift+z'); await expect.poll(placementOf).toEqual(labelled.annotation);
  await page.keyboard.press('Control+Shift+z'); await expect.poll(placementOf).toEqual(slid.annotation);

  // A relation mark beneath the text never takes its drag: with the value moved onto the mark of a side, the text is drawn and picked
  // above the mark, and a press there drags the dimension again.
  const markId = (await page.locator('[data-cad-sketch-relation-glyph]').first().getAttribute('data-cad-sketch-relation-glyph'))!;
  const mark = page.locator(`[data-cad-sketch-relation-glyph="${markId}"]`), onMark = await middle(mark);
  await drag(gap.id, await middle(label(gap.id)), onMark);
  const stacked = await page.evaluate(({ x, y }) => document.elementsFromPoint(x, y).map(element => element.closest('[data-cad-sketch-relation-glyph]') ? 'mark'
    : element.closest('[data-cad-sketch-dimension]') ? 'dimension' : null).filter(Boolean), onMark);
  expect(stacked[0]).toBe('dimension'); expect(stacked).toContain('mark');
  const beyond = { x: onMark.x + 30, y: onMark.y + 20 };
  await drag(gap.id, onMark, beyond); near(await middle(label(gap.id)), beyond);
  await expect(label(gap.id)).toHaveAttribute('aria-pressed', 'true'); await expect(mark).toHaveAttribute('aria-pressed', 'false');

  // Saved and reloaded, the dimension keeps its placement: its line is drawn at the same place in the sketch, and its text at the same place along it.
  // The text keeps a fixed gap in pixels from the line, so across the zoom the reload fits, only its place along the upright line is compared.
  const drawnAt = { line: (await sketchAt(await middle(line))).x, text: (await sketchAt(await middle(label(gap.id)))).y };
  const saveAndReload = async () => {
    await call(page, 'cad_set_viewport', { expectedVersion: (await context(page)).version, command: { kind: 'finish-sketch' } });
    await call(page, 'cad_save_document', { expectedVersion: (await context(page)).version });
    await page.reload(); await expect(page.getByRole('main', { name: 'Parametric CAD workbench' })).toBeVisible();
    await expect.poll(async () => (await context(page)).dirty).toBe(false); await editSketch();
  };
  const saved = await settled(), before = scale; await saveAndReload();
  expect((await settled()).relations).toEqual(saved.relations);
  scale = await mmPerPixel();
  const tolerance = 2 * Math.max(scale, before);
  expect(Math.abs((await sketchAt(await middle(line))).x - drawnAt.line)).toBeLessThan(tolerance);
  expect(Math.abs((await sketchAt(await middle(label(gap.id)))).y - drawnAt.text)).toBeLessThan(tolerance);

  // A 45° angle and a bore, each dimensioned and laid out automatically.
  const vertex = { x: 60, y: -40 }, bore = { x: -30, y: 10 };
  await call(page, 'cad_edit_document', { expectedVersion: (await context(page)).version, edits: [{ kind: 'append-sketch-entities', sketchId: sketch.id, geometry: {
    points: [{ id: 'v', position: [vertex.x, vertex.y] }, { id: 'p1', position: [90, -40] }, { id: 'p2', position: [80, -20] }, { id: 'c', position: [bore.x, bore.y] }],
    entities: [{ id: 'r1', kind: 'line', startPointId: 'v', endPointId: 'p1', construction: false }, { id: 'r2', kind: 'line', startPointId: 'v', endPointId: 'p2', construction: false },
      { id: 'ring', kind: 'circle', centerPointId: 'c', radius: 6, construction: false }],
    relations: [{ id: 'tilt', kind: 'line-angle', rays: [{ lineId: 'r1', towardPointId: 'p1' }, { lineId: 'r2', towardPointId: 'p2' }], sense: 'ccw', value: 45 },
      { id: 'ring_size', kind: 'radial-size', entityId: 'ring', quantity: 'radius', value: 6 }] } }] });
  await call(page, 'cad_set_viewport', { expectedVersion: (await context(page)).version, command: { kind: 'fit' } });
  await expect(label('tilt')).toBeVisible(); await expect(label('ring_size')).toBeVisible(); scale = await mmPerPixel();
  const turn = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

  // The angle's value moves along its arc, 12° further round and out from the corner; it lands where it is dropped.
  const angleFrom = await sketchAt(await middle(label('tilt'))), reach = Math.hypot(angleFrom.x - vertex.x, angleFrom.y - vertex.y);
  const direction = Math.atan2(angleFrom.y - vertex.y, angleFrom.x - vertex.x) + 12 * Math.PI / 180;
  const angleTo = await project(vertex.x + (reach + 6) * Math.cos(direction), vertex.y + (reach + 6) * Math.sin(direction));
  const angled = await drag('tilt', await middle(label('tilt')), angleTo);
  expect(angled.annotation).toEqual({ kind: 'angle', radius: expect.any(Number), along: expect.any(Number) });
  expect(Math.abs(Number(angled.annotation!.along) - direction / (Math.PI / 4))).toBeLessThan(0.03);
  expect(Number(angled.annotation!.along)).toBeGreaterThan(0.6);
  near(await middle(label('tilt')), angleTo);

  // The radius value turns its leader a quarter turn round the bore and keeps its distance from the center.
  const radiusFrom = await sketchAt(await middle(label('ring_size')));
  const offsetX = radiusFrom.x - bore.x, offsetY = radiusFrom.y - bore.y, radiusTo = await project(bore.x - offsetY, bore.y + offsetX);
  const turned = await drag('ring_size', await middle(label('ring_size')), radiusTo);
  expect(turned.annotation).toEqual({ kind: 'radial', angle: expect.any(Number), distance: expect.any(Number) });
  expect(Math.abs(turn(Number(turned.annotation!.angle) - Math.atan2(offsetX, -offsetY)))).toBeLessThan(0.03);
  expect(Math.abs(Number(turned.annotation!.distance) - Math.hypot(offsetX, offsetY))).toBeLessThan(2 * scale);
  near(await middle(label('ring_size')), radiusTo);

  // Both placements are saved with the sketch as well.
  const all = await settled(); await saveAndReload();
  expect((await settled()).relations).toEqual(all.relations);
});
