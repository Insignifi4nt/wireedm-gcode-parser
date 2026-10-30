import { expect, test } from './fixtures/native-sketch-solver';
import type { Page } from '@playwright/test';
import { prepareCadTools, callCadTool as call, cadContext as context, historyRow } from './cad-tool-helpers';

const edge = (id: string, startPointId: string, endPointId: string) => ({ id, kind: 'line', startPointId, endPointId, construction: false });
/** A 40 × 20 plate held by Horizontal, Vertical, Parallel and a fixed corner, with one Length dimension. */
const plate = { id: 'plate', kind: 'sketch', name: 'Plate', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: {
  points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [40, 0] }, { id: 'c', position: [40, 20] }, { id: 'd', position: [0, 20] }],
  entities: [edge('bottom', 'a', 'b'), edge('right', 'b', 'c'), edge('top', 'c', 'd'), edge('left', 'd', 'a')],
  relations: [{ id: 'level', kind: 'horizontal', pointIds: ['a', 'b'] }, { id: 'upright', kind: 'vertical', pointIds: ['b', 'c'] }, { id: 'side', kind: 'vertical', pointIds: ['d', 'a'] },
    { id: 'across', kind: 'parallel', lineIds: ['bottom', 'top'] }, { id: 'anchor', kind: 'fixed-point', pointId: 'a', position: [0, 0] },
    { id: 'length', kind: 'distance', pointIds: ['a', 'b'], value: 40 }] } };

async function openPlate(page: Page) {
  await prepareCadTools(page); await call(page, 'cad_open_workspace');
  await call(page, 'cad_edit_document', { expectedVersion: (await context(page)).version, edits: [{ kind: 'add-feature', feature: plate }] });
  await (await historyRow(page, 'Plate')).dblclick();
  await expect(page.getByRole('button', { name: 'Finish sketch', exact: true })).toBeVisible();
  return { glyph: (id: string) => page.locator(`[data-cad-sketch-relation-glyph="${id}"]`), status: page.locator('[data-cad-dimension-status]') };
}
const selection = async (page: Page) => (await call(page, 'cad_get_viewport', { expectedVersion: (await context(page)).version })).selectedSketchGeometrySet;

test('marks the relations of a rectangle, lights their geometry on hover and deletes the selected ones in one undo step', async ({ page }) => {
  const { glyph, status } = await openPlate(page);
  // Five relations draw six marks; the Length keeps its own label.
  await expect(page.locator('[data-cad-sketch-relation-glyph]')).toHaveCount(6);
  await expect(glyph('across')).toHaveCount(2); await expect(glyph('length')).toHaveCount(0);
  await expect(glyph('across').first()).toHaveAttribute('aria-label', /^Parallel: Line \d and Line \d$/);
  await expect(glyph('level')).toHaveAttribute('aria-label', 'Horizontal: Point 1 and Point 2');

  // Hover lights the held lines and the relation's other mark, and selects nothing.
  await glyph('across').first().hover();
  await expect(page.locator('[data-cad-highlight-entity="bottom"]')).toHaveCount(1); await expect(page.locator('[data-cad-highlight-entity="top"]')).toHaveCount(1);
  await expect(page.locator('[data-cad-highlight-glyph="across"]')).toHaveCount(2); await expect(status).toHaveCount(0);

  await glyph('level').click();
  await expect(glyph('level')).toHaveAttribute('aria-pressed', 'true'); await expect(status).toHaveText('Horizontal selected · Delete removes');
  await glyph('across').first().click({ modifiers: ['Shift'] });
  await expect(status).toHaveText('2 relations selected · Delete removes them'); await expect(glyph('across').last()).toHaveAttribute('aria-pressed', 'true');
  expect(await selection(page)).toEqual([]);
  await page.keyboard.press('Delete');
  await expect(glyph('level')).toHaveCount(0); await expect(glyph('across')).toHaveCount(0); await expect(glyph('upright')).toHaveCount(1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(glyph('level')).toHaveCount(1); await expect(glyph('across')).toHaveCount(2);

  // Double-click opens the relations list on the relation's row.
  await glyph('upright').dblclick();
  await expect(page.locator('ul[aria-label="Sketch relations"] button[aria-pressed="true"][aria-label^="Inspect Vertical "]')).toHaveCount(1);
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Finish sketch', exact: true }).click();
  await expect.poll(() => context(page)).toMatchObject({ workflowOpen: false });
  const current = await context(page);
  expect((await call(page, 'cad_get_feature', { expectedVersion: current.version, featureId: 'plate' })).feature.graph.relations).toEqual(plate.graph.relations);
});

test('moves the marks of dragged geometry with it while the drag is drawn and after it is saved', async ({ page }) => {
  const { glyph } = await openPlate(page);
  // The plate's top edge, held parallel to the bottom, rises with its corner; the Parallel mark on it follows.
  const top = async () => {
    const boxes = (await Promise.all((await glyph('across').all()).map(item => item.boundingBox()))).filter(box => box !== null);
    return boxes.sort((a, b) => a.y - b.y)[0];
  };
  const before = await top(), corner = await page.locator('[data-cad-sketch-point="c"]').boundingBox();
  if (!before || !corner) throw new Error('Plate corner or mark unavailable.');
  const x = corner.x + corner.width / 2, y = corner.y + corner.height / 2;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x, y - 40, { steps: 8 });
  await expect.poll(async () => before.y - ((await top())?.y ?? before.y)).toBeGreaterThan(25);
  expect(Math.abs(((await top())?.x ?? Infinity) - before.x)).toBeLessThan(2);
  await page.mouse.up();
  await expect.poll(async () => before.y - ((await top())?.y ?? before.y)).toBeGreaterThan(25);
  await expect(glyph('across')).toHaveCount(2);
});

test('leaves a pick on the geometry beside a mark, in Select and with a drawing tool', async ({ page }) => {
  const { glyph, status } = await openPlate(page);
  // The fixed corner's mark sits diagonally off the corner, its near side over the left edge's pick reach.
  const box = await glyph('anchor').boundingBox(); if (!box) throw new Error('Fixed mark unavailable.');
  const beside = { x: box.x + 1.5, y: box.y + box.height / 2 }, middle = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.click(beside.x, beside.y);
  expect(await selection(page)).toEqual([{ kind: 'entity', id: 'left' }]);
  await expect(glyph('anchor')).toHaveAttribute('aria-pressed', 'false'); await expect(status).toHaveCount(0);
  // Its middle selects the fix, which replaces the edge.
  await page.mouse.click(middle.x, middle.y);
  await expect(glyph('anchor')).toHaveAttribute('aria-pressed', 'true'); await expect(status).toHaveText(/ selected · Delete removes$/);
  expect(await selection(page)).toEqual([]);
  await page.keyboard.press('Escape'); await expect(glyph('anchor')).toHaveAttribute('aria-pressed', 'false');

  // With Line, every mark is inert: a click on one starts a chain there, and a pending chain keeps them inert.
  await page.getByRole('button', { name: 'Line', exact: true }).click();
  await expect(glyph('anchor')).toHaveAttribute('tabindex', '-1');
  const opened = await context(page);
  await page.mouse.click(middle.x, middle.y);
  await expect.poll(() => context(page)).toMatchObject({ version: opened.version, workflowOpen: true });
  await expect(glyph('anchor')).toHaveAttribute('aria-pressed', 'false'); await expect(glyph('anchor')).toHaveCSS('pointer-events', 'none');
  await page.keyboard.press('Escape'); await expect.poll(() => context(page)).toMatchObject({ version: opened.version, workflowOpen: false });
  await page.keyboard.press('Escape'); await expect(page.getByRole('button', { name: 'Select', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(glyph('anchor')).toHaveAttribute('tabindex', '0');
});

test('leaves a dimension line or label that crosses a mark its hover, click, double-click and menu', async ({ page }) => {
  await prepareCadTools(page); await call(page, 'cad_open_workspace');
  // The fixed centre's mark sits diagonally off the centre, right on the circle's diagonal size line. A fixed point at the line's arrow
  // tip puts its mark under the size label too.
  const tip = 10 * Math.SQRT1_2;
  const sketch = { id: 'hole', kind: 'sketch', name: 'Hole', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: {
    points: [{ id: 'o', position: [30, 20] }, { id: 'p', position: [30 + tip, 20 + tip] }], entities: [{ id: 'ring', kind: 'circle', centerPointId: 'o', radius: 10, construction: false }],
    relations: [{ id: 'pin', kind: 'fixed-point', pointId: 'o', position: [30, 20] }, { id: 'peg', kind: 'fixed-point', pointId: 'p', position: [30 + tip, 20 + tip] },
      { id: 'size', kind: 'radial-size', entityId: 'ring', quantity: 'diameter', value: 20 }] } };
  await call(page, 'cad_edit_document', { expectedVersion: (await context(page)).version, edits: [{ kind: 'add-feature', feature: sketch }] });
  await (await historyRow(page, 'Hole')).dblclick();
  await expect(page.getByRole('button', { name: 'Finish sketch', exact: true })).toBeVisible();
  const glyph = (id: string) => page.locator(`[data-cad-sketch-relation-glyph="${id}"]`), status = page.locator('[data-cad-dimension-status]');
  const label = page.locator('[data-cad-sketch-dimension="size"] [role="button"]'), pointed = page.locator('[data-cad-sketch-dimension="size"].is-pointed');
  const editor = page.getByRole('textbox', { name: 'Diameter mm', exact: true }), reference = page.getByRole('menuitem', { name: 'Make reference', exact: true });
  const listed = page.getByRole('menuitem', { name: 'Show in relations list', exact: true });
  const clear = async () => {
    await page.mouse.move(2, 2); await page.getByRole('application', { name: 'Sketch drawing canvas', exact: true }).press('Escape');
    await expect(label).toHaveAttribute('aria-pressed', 'false'); await expect(glyph('pin')).toHaveAttribute('aria-pressed', 'false');
  };
  const box = await glyph('pin').boundingBox(); if (!box) throw new Error('Fixed mark unavailable.');
  const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  expect(await page.locator('[data-cad-sketch-dimension-hit="size"]').evaluate((group, at) => document.elementsFromPoint(at.x, at.y).some(element => group.contains(element)), at)).toBe(true);

  // Hover points out the dimension, not the fix.
  await page.mouse.move(at.x, at.y);
  await expect(pointed).toHaveCount(1); await expect(page.locator('[data-cad-highlight-glyph="pin"]')).toHaveCount(0);
  // A click selects the dimension, so Delete removes the dimension and keeps the fix.
  await page.mouse.click(at.x, at.y);
  await expect(label).toHaveAttribute('aria-pressed', 'true'); await expect(glyph('pin')).toHaveAttribute('aria-pressed', 'false');
  await expect(status).toHaveText('Diameter selected · Double-click or Enter edits · Delete removes');
  await page.keyboard.press('Delete'); await expect(label).toHaveCount(0); await expect(glyph('pin')).toHaveCount(1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(label).toHaveCount(1);
  await clear();
  // A right-click opens the dimension's menu, and a double-click its editor.
  await page.mouse.click(at.x, at.y, { button: 'right' }); await expect(reference).toBeVisible(); await expect(listed).toHaveCount(0);
  await page.keyboard.press('Escape'); await expect(reference).toHaveCount(0);
  await clear();
  await page.mouse.dblclick(at.x, at.y); await expect(editor).toHaveValue('20');
  await page.keyboard.press('Escape'); await expect(editor).toHaveCount(0);
  await clear();

  // Where the arrow tip's mark lies under the size label, the label keeps the click and the menu.
  const [peg, tag] = await Promise.all([glyph('peg').boundingBox(), label.boundingBox()]); if (!peg || !tag) throw new Error('Mark or label unavailable.');
  const left = Math.max(peg.x, tag.x), right = Math.min(peg.x + peg.width, tag.x + tag.width), top = Math.max(peg.y, tag.y), bottom = Math.min(peg.y + peg.height, tag.y + tag.height);
  expect(right - left).toBeGreaterThan(4); expect(bottom - top).toBeGreaterThan(4);
  const overlap = { x: (left + right) / 2, y: (top + bottom) / 2 };
  await page.mouse.click(overlap.x, overlap.y);
  await expect(label).toHaveAttribute('aria-pressed', 'true'); await expect(glyph('peg')).toHaveAttribute('aria-pressed', 'false');
  await clear();
  await page.mouse.click(overlap.x, overlap.y, { button: 'right' }); await expect(reference).toBeVisible(); await expect(listed).toHaveCount(0);
  await page.keyboard.press('Escape');
});
