import { expect, test } from './fixtures/native-sketch-solver';
import { prepareCadTools, callCadTool as call, rawCadToolCall as rawCall, cadContext as context } from './cad-tool-helpers';

test('places each dimension where the pointer puts it, falls back to a reference, applies a menu relation and undoes every placement', async ({ page }) => {
  await prepareCadTools(page); await call(page, 'cad_open_workspace');
  // Two parallel lines, a slanted line, a bore, and a line whose ends are fixed so that a driving length would over-define it.
  const sketch = { id: 'plate', kind: 'sketch', name: 'Placement plate', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: {
    points: [{ id: 'a', position: [10, 10] }, { id: 'b', position: [50, 10] }, { id: 'c', position: [15, 30] }, { id: 'd', position: [45, 30] },
      { id: 'e', position: [80, 10] }, { id: 'f', position: [90, 25] }, { id: 'g', position: [60, 40] }, { id: 'h', position: [72, 40] }, { id: 'o', position: [30, 20] }],
    entities: [{ id: 'base', kind: 'line', startPointId: 'a', endPointId: 'b', construction: false }, { id: 'top', kind: 'line', startPointId: 'c', endPointId: 'd', construction: false },
      { id: 'slant', kind: 'line', startPointId: 'e', endPointId: 'f', construction: false }, { id: 'held', kind: 'line', startPointId: 'g', endPointId: 'h', construction: false },
      { id: 'bore', kind: 'circle', centerPointId: 'o', radius: 3, construction: false }],
    relations: [{ id: 'gp', kind: 'fixed-point', pointId: 'g', position: [60, 40] }, { id: 'hp', kind: 'fixed-point', pointId: 'h', position: [72, 40] }] } };
  await call(page, 'cad_edit_document', { expectedVersion: (await context(page)).version, edits: [{ kind: 'add-feature', feature: sketch }] });
  const initial = await context(page);
  await expect.poll(() => rawCall(page, 'cad_get_viewport', { expectedVersion: initial.version })).toMatchObject({ ok: true, data: { view: { available: true, referenceVersion: initial.version } } });
  await call(page, 'cad_set_viewport', { expectedVersion: initial.version, command: { kind: 'edit-sketch', sketchId: sketch.id } });

  const canvas = page.getByLabel('Sketch drawing canvas'), tool = page.getByRole('button', { name: 'Dimension', exact: true });
  const preview = page.locator('[data-cad-dimension-preview]'), selected = page.locator('[data-cad-sketch-dimension] [role="button"][aria-pressed="true"]');
  const project = async (x: number, y: number) => {
    const current = await context(page), center = (await call(page, 'cad_get_viewport', { expectedVersion: current.version })).view.centerMm as [number, number];
    return canvas.evaluate((element, { x, y, center }) => {
      const matrix = (element as SVGSVGElement).getScreenCTM(); if (!matrix) throw new Error('Sketch projection unavailable.');
      const point = new DOMPoint(x - center[0], center[1] - y).matrixTransform(matrix); return { x: point.x, y: point.y };
    }, { x, y, center });
  };
  const hover = async (x: number, y: number) => { const point = await project(x, y); await page.mouse.move(point.x, point.y); };
  const clickAt = async (x: number, y: number, button: 'left' | 'right' = 'left') => { const point = await project(x, y); await page.mouse.click(point.x, point.y, { button }); };
  const pick = (selector: string) => page.locator(selector).press('Enter');
  const settled = async () => {
    await expect.poll(() => context(page)).toMatchObject({ workflowOpen: false }); const current = await context(page);
    return { version: current.version, relations: (await call(page, 'cad_get_feature', { expectedVersion: current.version, featureId: sketch.id })).feature.graph.relations as unknown[] };
  };
  const steps = [await settled()];
  // Placing stores where the preview drew the dimension, its line through the pointer, also for Enter while the pointer rests on the sketch;
  // the pointer lands within a pixel of the projected position.
  const at = (offset: number) => ({ kind: 'linear', offset: expect.closeTo(offset, 0), along: 0.5 });
  const placed = async (relation: unknown) => {
    await expect.poll(async () => (await settled()).relations.length).toBe(steps.at(-1)!.relations.length + 1);
    const next = await settled(); expect(next.relations).toEqual([...steps.at(-1)!.relations, relation]); steps.push(next);
  };

  // D starts the tool. One line previews its length wherever the pointer is, and a click on empty space places it at the measured value.
  await canvas.focus(); await page.keyboard.press('d'); await expect(tool).toHaveAttribute('aria-pressed', 'true');
  await clickAt(30, 10); await hover(25, 14);
  await expect(preview).toHaveAttribute('data-cad-dimension-preview', 'aligned');
  await expect(canvas).toHaveAccessibleDescription(/^Length · Click or press Enter to place/);
  // The preview draws in a pointer-transparent overlay laid exactly over the canvas, so the click that places it still reaches the canvas.
  const overlay = page.locator('svg[data-cad-sketch-overlay="pointer"]');
  await expect(overlay.locator('[data-cad-dimension-preview]')).toHaveCount(1); await expect(overlay).toHaveCSS('pointer-events', 'none');
  expect(await overlay.boundingBox()).toEqual(await canvas.boundingBox());
  await clickAt(25, 14);
  await placed({ id: expect.any(String), kind: 'distance', pointIds: ['a', 'b'], value: 40, annotation: at(4) });
  // The tool stays on with the new dimension selected, and Enter opens its editor at the placed value; a cancelled edit changes nothing.
  await expect(tool).toHaveAttribute('aria-pressed', 'true'); await expect(selected).toHaveCount(1);
  await expect(canvas).toHaveAccessibleDescription(/^Dimension placed · Enter or double-click edits it/);
  await page.keyboard.press('Enter'); await expect(page.getByRole('textbox', { name: 'Length mm', exact: true })).toHaveValue('40');
  await page.getByRole('textbox', { name: 'Length mm', exact: true }).fill('45'); await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect((await context(page)).version).toBe(steps.at(-1)!.version);

  // Right-click during the preview lists the dimension types and the relations that fit; a relation applies and leaves the tool idle.
  await tool.click(); await clickAt(30, 10); await clickAt(30, 30); await hover(60, 20);
  await expect(preview).toHaveAttribute('data-cad-dimension-preview', 'point-line');
  await clickAt(60, 20, 'right');
  await expect(page.getByRole('menuitem', { name: 'Angle', exact: true })).toBeDisabled();
  await expect(page.getByRole('menuitem', { name: 'Angle', exact: true })).toHaveAttribute('aria-description', 'These lines are parallel, so they have no angle.');
  await expect(page.getByRole('menuitem', { name: 'Place as reference', exact: true })).toBeEnabled();
  await expect(page.getByRole('menuitem', { name: 'Swap location', exact: true })).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'Parallel', exact: true }).click();
  await placed({ id: expect.any(String), kind: 'parallel', lineIds: ['base', 'top'] });
  await expect(tool).toHaveAttribute('aria-pressed', 'true'); await expect(preview).toHaveCount(0);
  await expect(canvas).toHaveAccessibleDescription(/^Dimension · Choose a line, arc, circle, point, the origin or an axis/);

  // The same lines now take their distance alone, since Parallel already holds them. Focus stays on the top line the pointer picked last, which
  // takes no more picks, and Enter there places the distance; focus then moves to the canvas, so Enter again edits that distance.
  await clickAt(30, 10); await clickAt(30, 30); await hover(60, 20); await expect(preview).toHaveAttribute('data-cad-dimension-preview', 'point-line');
  await expect(page.locator('[data-cad-sketch-entity="top"]')).toBeFocused(); await page.keyboard.press('Enter');
  await placed({ id: expect.any(String), kind: 'point-line-distance', pointId: 'c', lineId: 'base', side: expect.any(String), value: 20, annotation: at(45) });
  await expect(canvas).toBeFocused(); await page.keyboard.press('Enter');
  const gap = page.getByRole('textbox', { name: 'Point to line distance mm', exact: true });
  await expect(gap).toHaveValue('20'); await gap.fill('25'); await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect((await context(page)).version).toBe(steps.at(-1)!.version);

  // Lines that are not parallel take an angle; the editor left Dimension, so the tool starts again.
  await tool.click(); await clickAt(30, 10); await clickAt(85, 17.5); await hover(65, 20); await expect(preview).toHaveAttribute('data-cad-dimension-preview', 'angle');
  await clickAt(65, 20);
  await placed(expect.objectContaining({ kind: 'line-angle' }));

  // One slanted line places its length above and beside it alike; its horizontal and vertical distances are only in the menu.
  await clickAt(85, 17.5); await hover(85, 35); await expect(preview).toHaveAttribute('data-cad-dimension-preview', 'aligned');
  await hover(74, 17); await expect(preview).toHaveAttribute('data-cad-dimension-preview', 'aligned');
  await clickAt(74, 17);
  await placed({ id: expect.any(String), kind: 'distance', pointIds: ['e', 'f'], value: Math.hypot(10, 15), annotation: at((6 * 15 + 7 * 10) / Math.hypot(10, 15)) });

  // For two points, the pointer above or below both gives a horizontal distance, beside both a vertical one, and between them an aligned one.
  await pick('[data-cad-sketch-point="a"]'); await pick('[data-cad-sketch-point="o"]');
  await hover(20, 25); await expect(preview).toHaveAttribute('data-cad-dimension-preview', 'horizontal');
  await hover(20, 15); await expect(preview).toHaveAttribute('data-cad-dimension-preview', 'aligned');
  await hover(40, 15); await expect(preview).toHaveAttribute('data-cad-dimension-preview', 'vertical');
  await clickAt(40, 15);
  await placed({ id: expect.any(String), kind: 'axis-distance', axis: 'y', pointIds: ['a', 'o'], value: 10, annotation: at(20) });

  // A point and an axis, then Enter, hold the point at its distance from that axis, a plain Distance, drawn through the pointer left at (40, 15).
  await pick('[data-cad-sketch-point="c"]'); await pick('[data-cad-sketch-fixed="@h"]');
  await expect(canvas).toHaveAccessibleDescription(/^Distance · Click or press Enter to place/);
  await page.keyboard.press('Enter');
  await placed({ id: expect.any(String), kind: 'fixed-axis', pointId: 'c', axis: 'y', value: 30, annotation: at(-25) });

  // A length the fixed ends already set would over-define the sketch, so it is placed as a reference and the status line says so.
  await clickAt(66, 40); await hover(66, 35); await expect(preview).toHaveAttribute('data-cad-dimension-preview', 'aligned');
  await clickAt(66, 35);
  await placed({ id: expect.any(String), kind: 'reference-dimension', measurement: { kind: 'line-length', entityId: 'held' }, annotation: at(-5) });
  await expect(page.getByText('Placed as a reference: a driving dimension would over-define the sketch.').first()).toBeVisible();

  // Escape drops the picks and keeps the tool; with nothing picked it returns to Select.
  await pick('[data-cad-sketch-point="a"]'); await page.keyboard.press('Escape');
  await expect(tool).toHaveAttribute('aria-pressed', 'true'); await expect(canvas).toHaveAccessibleDescription(/^Dimension · Choose/);
  await canvas.press('Escape'); await expect(page.getByRole('button', { name: 'Select', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect((await context(page)).version).toBe(steps.at(-1)!.version);

  // Each placement, the fallback reference and the menu relation is one undo step.
  for (const step of steps.slice(0, -1).reverse()) {
    await canvas.focus(); await page.keyboard.press('Control+z');
    await expect.poll(async () => (await settled()).relations).toEqual(step.relations);
  }
  const undone = await context(page);
  expect((await call(page, 'cad_get_feature', { expectedVersion: undone.version, featureId: sketch.id })).feature).toEqual(sketch);
});
