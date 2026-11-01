import { expect, test } from './fixtures/native-sketch-solver';
import type { Page } from '@playwright/test';
import { prepareCadTools, callCadTool as call, cadContext as context, historyRow, openSketchRelations, relationRow } from './cad-tool-helpers';

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

  // Double-click selects the relation, its row under the sketch in the feature tree too.
  await glyph('upright').dblclick();
  await expect(relationRow(page, 'Vertical relation 2 ·')).toHaveAttribute('aria-pressed', 'true');
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
  // While the drag is drawn, the moved marks draw beside the layer and their rows stay hidden where the saved sketch places them.
  const highestMoved = async () => {
    const boxes = (await Promise.all((await page.locator('.cad-sketch-relation-glyphs-moved path').all()).map(item => item.boundingBox()))).filter(box => box !== null);
    return boxes.sort((a, b) => a.y - b.y)[0];
  };
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x, y - 40, { steps: 8 });
  await expect.poll(async () => before.y - ((await highestMoved())?.y ?? before.y)).toBeGreaterThan(25);
  await expect(glyph('across').and(page.locator('[visibility="hidden"]'))).toHaveCount(1);
  expect((await top())?.y).toBeCloseTo(before.y, 0);
  await page.mouse.up();
  await expect.poll(async () => before.y - ((await top())?.y ?? before.y)).toBeGreaterThan(25);
  expect(Math.abs(((await top())?.x ?? Infinity) - before.x)).toBeLessThan(2);
  await expect(glyph('across')).toHaveCount(2); await expect(page.locator('.cad-sketch-relation-glyphs-moved')).toHaveCount(0);
  await expect(page.locator('[data-cad-sketch-relation-glyph][visibility="hidden"]')).toHaveCount(0);
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

test('leaves the Dimension tool its picks, preview hover and placement click over a mark', async ({ page }) => {
  const { glyph } = await openPlate(page);
  const tool = page.getByRole('button', { name: 'Dimension', exact: true }), preview = page.locator('[data-cad-dimension-preview]');
  const lit = page.locator('[data-cad-highlight-glyph="upright"]'), length = page.locator('[data-cad-sketch-dimension="length"] [role="button"]');
  const box = await glyph('upright').boundingBox(); if (!box) throw new Error('Vertical mark unavailable.');
  const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  // Waiting for its first pick, the tool keeps the placed Length interactive but every mark inert.
  await tool.click(); await expect(tool).toHaveAttribute('aria-pressed', 'true');
  await expect(glyph('upright')).toHaveCSS('pointer-events', 'none'); await expect(glyph('upright')).toHaveAttribute('tabindex', '-1'); await expect(length).toHaveAttribute('tabindex', '0');
  await page.mouse.move(at.x, at.y); await expect(lit).toHaveCount(0);
  // With the right edge picked, the preview follows the pointer onto the mark, which the pointer passes through to the canvas.
  await page.locator('[data-cad-sketch-entity="right"]').press('Enter');
  await page.mouse.move(at.x - 4, at.y); await page.mouse.move(at.x, at.y);
  await expect(preview).toHaveCount(1); await expect(lit).toHaveCount(0);
  expect(await page.evaluate(at => document.elementsFromPoint(at.x, at.y).some(element => element.closest('[data-cad-sketch-relation-glyph]')), at)).toBe(false);
  const before = await context(page);
  await page.mouse.click(at.x, at.y);
  await expect.poll(async () => (await context(page)).version).not.toBe(before.version);
  await expect.poll(async () => { const current = await context(page); return (await call(page, 'cad_get_feature', { expectedVersion: current.version, featureId: 'plate' })).feature.graph.relations.at(-1); })
    .toMatchObject({ kind: 'distance', pointIds: ['b', 'c'], value: 20 });
  await expect(glyph('upright')).toHaveAttribute('aria-pressed', 'false'); await expect(tool).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape'); await expect(page.getByRole('button', { name: 'Select', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(glyph('upright')).toHaveAttribute('tabindex', '0');
});

/** Two fixed points 0.4 mm apart, whose marks overlap, and a short upright edge beside the rectangle's right edge. */
const close = { id: 'close', kind: 'sketch', name: 'Close', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: {
  points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [40, 0] }, { id: 'c', position: [40, 20] }, { id: 'd', position: [0, 20] },
    { id: 'e', position: [10, 30] }, { id: 'g', position: [10.4, 30] }, { id: 'i', position: [43, 8] }, { id: 'j', position: [43, 12] }],
  entities: [edge('bottom', 'a', 'b'), edge('right', 'b', 'c'), edge('top', 'c', 'd'), edge('left', 'd', 'a'), edge('post', 'i', 'j')],
  relations: [{ id: 'level', kind: 'horizontal', pointIds: ['a', 'b'] }, { id: 'upright', kind: 'vertical', pointIds: ['b', 'c'] },
    { id: 'pin', kind: 'fixed-point', pointId: 'e', position: [10, 30] }, { id: 'peg', kind: 'fixed-point', pointId: 'g', position: [10.4, 30] },
    { id: 'beside', kind: 'vertical', pointIds: ['i', 'j'] }] } };

async function openClose(page: Page) {
  await prepareCadTools(page); await call(page, 'cad_open_workspace');
  await call(page, 'cad_edit_document', { expectedVersion: (await context(page)).version, edits: [{ kind: 'add-feature', feature: close }] });
  await (await historyRow(page, 'Close')).dblclick();
  await expect(page.getByRole('button', { name: 'Finish sketch', exact: true })).toBeVisible();
  const glyph = (id: string) => page.locator(`[data-cad-sketch-relation-glyph="${id}"]`);
  const centre = async (id: string) => { const box = await glyph(id).boundingBox(); if (!box) throw new Error(`Mark ${id} unavailable.`); return { ...box, cx: box.x + box.width / 2, cy: box.y + box.height / 2 }; };
  // The relation of the mark the pointer finds at a place, if any.
  const markAt = (at: { x: number; y: number }) => page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-cad-sketch-relation-glyph]')?.getAttribute('data-cad-sketch-relation-glyph') ?? null, at);
  // The overlapping Fixed marks in row order, the middle of their overlap and, on each, a place the other leaves alone.
  const order = await page.locator('[data-cad-sketch-relation-glyph]').evaluateAll(items => items.map(item => item.getAttribute('data-cad-sketch-relation-glyph')));
  const [earlier, later] = order.filter(id => id === 'pin' || id === 'peg') as [string, string];
  const places = async () => {
    const first = await centre(earlier), second = await centre(later), rightward = second.x > first.x;
    const left = Math.max(first.x, second.x), right = Math.min(first.x + first.width, second.x + second.width), top = Math.max(first.y, second.y), bottom = Math.min(first.y + first.height, second.y + second.height);
    expect(right - left).toBeGreaterThan(2); expect(bottom - top).toBeGreaterThan(2);
    const lefts = (first.x + second.x) / 2, rights = (first.x + first.width + second.x + second.width) / 2;
    return { overlap: { x: (left + right) / 2, y: (top + bottom) / 2 }, alone: { [earlier]: { x: rightward ? lefts : rights, y: first.cy }, [later]: { x: rightward ? rights : lefts, y: first.cy } } };
  };
  return { glyph, centre, markAt, earlier, later, places };
}

/**
 * The relation of the mark whose plate is painted topmost at a place, read from the paint order: the shared plate paths, the rows' plates
 * and the lit copies' plates in document order, and each shared path's plates in the order its data draws them. A plate paints its 1 px
 * stroke half outside its square. Rings, outlines that take no pointer, and icons, which lie inside their own plate, are left out.
 */
const paintedAt = (page: Page, at: { x: number; y: number }) => page.evaluate(({ x, y }) => {
  const layer = document.querySelector<SVGGElement>('.cad-sketch-relation-glyphs')!, place = new DOMPoint(x, y).matrixTransform(layer.getScreenCTM()!.inverse());
  const rows = [...layer.querySelectorAll<SVGGElement>('[data-cad-sketch-relation-glyph]')].map(row => ({ row, box: row.querySelector('rect')!.getBBox() }));
  const probe = document.createElementNS('http://www.w3.org/2000/svg', 'path'); layer.append(probe);
  let top: string | null = null;
  for (const item of layer.querySelectorAll<SVGGraphicsElement>(':scope > path.cad-sketch-relation-glyph-plates, [data-cad-sketch-relation-glyph] > rect, .cad-sketch-relation-glyphs-lit path.cad-sketch-relation-glyph-plates')) {
    if (getComputedStyle(item).visibility !== 'visible') continue;
    for (const figure of item instanceof SVGPathElement ? item.getAttribute('d')!.split(/(?=M)/) : [null]) {
      if (figure !== null) probe.setAttribute('d', figure);
      const box = figure === null ? item.getBBox() : probe.getBBox(), cx = box.x + box.width / 2, cy = box.y + box.height / 2;
      if (Math.abs(place.x - cx) > box.width / 2 + 0.5 || Math.abs(place.y - cy) > box.height / 2 + 0.5) continue;
      const owner = rows.find(({ box: plate }) => Math.abs(plate.x + plate.width / 2 - cx) < 0.05 && Math.abs(plate.y + plate.height / 2 - cy) < 0.05);
      top = owner?.row.getAttribute('data-cad-sketch-relation-glyph') ?? 'a plate of no mark';
    }
  }
  probe.remove();
  return top;
}, at);

test('picks a mark painted in the shared paths where it lies: the top one of two that overlap, and the one beside a mark a drag moved', async ({ page }) => {
  const { glyph, centre, markAt, earlier, later, places } = await openClose(page);
  // Every mark paints in the shared paths; its own element paints nothing but still takes the pointer.
  await expect(page.locator('[data-cad-sketch-relation-glyph]')).toHaveCount(5);
  await expect(page.locator('[data-cad-sketch-relation-glyph] > rect[visibility="hidden"]')).toHaveCount(5);
  // The two overlapping marks paint in two layers of the shared paths, the later one in the later layer.
  await expect(page.locator('.cad-sketch-relation-glyphs > path.cad-sketch-relation-glyph-plates')).toHaveCount(2);
  for (const id of ['level', 'upright', 'beside']) { const at = await centre(id); expect(await markAt({ x: at.cx, y: at.cy })).toBe(id); }

  // The Fixed marks overlap. The later one draws over the earlier and takes the overlap; the rest of the earlier one keeps its own pick.
  const { overlap, alone } = await places();
  expect(await markAt(overlap)).toBe(later); expect(await markAt(alone[earlier])).toBe(earlier);
  await page.mouse.click(overlap.x, overlap.y);
  await expect(glyph(later)).toHaveAttribute('aria-pressed', 'true'); await expect(glyph(earlier)).toHaveAttribute('aria-pressed', 'false');
  await page.mouse.click(alone[earlier].x, alone[earlier].y);
  await expect(glyph(earlier)).toHaveAttribute('aria-pressed', 'true'); await expect(glyph(later)).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('Escape'); await expect(glyph(earlier)).toHaveAttribute('aria-pressed', 'false');

  // Dragging the top right corner up moves the right edge's Vertical; the drag keeps every mark inert, and the mark beside it keeps its place.
  const near = await centre('beside'), moving = await centre('upright'), corner = await page.locator('[data-cad-sketch-point="c"]').boundingBox();
  if (!corner) throw new Error('Corner unavailable.');
  await page.mouse.move(corner.x + corner.width / 2, corner.y + corner.height / 2); await page.mouse.down();
  await page.mouse.move(corner.x + corner.width / 2, corner.y + corner.height / 2 - 60, { steps: 8 });
  await expect(glyph('upright')).toHaveAttribute('visibility', 'hidden');
  expect(await markAt({ x: near.cx, y: near.cy })).toBeNull(); expect((await centre('beside')).cy).toBeCloseTo(near.cy, 0);
  await page.mouse.up();
  // Once the drag is saved, the mark beside picks where it lay and the moved one where the drag left it.
  await expect.poll(() => markAt({ x: near.cx, y: near.cy })).toBe('beside');
  const moved = await centre('upright'); expect(moving.cy - moved.cy).toBeGreaterThan(20);
  expect(await markAt({ x: moving.cx, y: moving.cy })).toBeNull(); expect(await markAt({ x: moved.cx, y: moved.cy })).toBe('upright');
  await page.mouse.click(near.cx, near.cy); await expect(glyph('beside')).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.click(moved.cx, moved.cy); await expect(glyph('upright')).toHaveAttribute('aria-pressed', 'true'); await expect(glyph('beside')).toHaveAttribute('aria-pressed', 'false');
});

test('draws on top the mark the pointer picks where two marks overlap, with the earlier or the later one selected, focused, related to selected geometry or lit', async ({ page }) => {
  const { glyph, markAt, earlier, later, places } = await openClose(page);
  const canvas = page.getByRole('application', { name: 'Sketch drawing canvas', exact: true }), ring = (id: string) => page.locator(`[data-cad-highlight-glyph="${id}"]`);
  const pointOf: Record<string, string> = { pin: 'e', peg: 'g' };
  const selectPoint = async (id: string) => {
    await page.locator(`[data-cad-sketch-point="${pointOf[id]}"]`).press('Enter');
    expect(await selection(page)).toEqual([{ kind: 'point', id: pointOf[id] }]); await expect(glyph(id)).toHaveClass(/\bis-related\b/);
  };
  const states: readonly { readonly name: string; enter(id: string): Promise<void> }[] = [
    // Selected through the part of it the other mark leaves alone, then left with neither focus nor the pointer.
    { name: 'selected', enter: async id => {
      await page.mouse.click((await places()).alone[id].x, (await places()).alone[id].y); await expect(glyph(id)).toHaveAttribute('aria-pressed', 'true');
      await page.mouse.move(2, 2); await canvas.focus();
    } },
    { name: 'focused', enter: async id => { await glyph(id).focus(); await expect(glyph(id)).toBeFocused(); } },
    { name: 'related to selected geometry', enter: selectPoint },
    // Hovered where the other mark leaves it alone, so the pointer stays on it while the overlap is read.
    { name: 'lit by hover', enter: async id => { const at = (await places()).alone[id]; await page.mouse.move(at.x, at.y); await expect(ring(id)).toHaveCount(1); } },
    // Focused in the tree's relations, listed for its selected point alone, which lights it until the row loses focus.
    { name: 'lit by its relations list row', enter: async id => {
      await selectPoint(id); await openSketchRelations(page); const row = relationRow(page, /^Fixed/);
      await expect(page.locator('ul[aria-label="Sketch relations"] li')).toHaveCount(1); await row.focus(); await expect(ring(id)).toHaveCount(1);
    } }
  ];
  for (const id of [earlier, later]) for (const state of states) {
    await state.enter(id);
    const { overlap, alone } = await places(), label = `${id === earlier ? 'earlier' : 'later'} mark ${state.name}`;
    // The later mark is drawn on top where they overlap and takes the pointer there; the rest of each mark is drawn and picked as itself.
    expect({ painted: await paintedAt(page, overlap), picked: await markAt(overlap) }, label).toEqual({ painted: later, picked: later });
    for (const each of [earlier, later]) expect({ painted: await paintedAt(page, alone[each]), picked: await markAt(alone[each]) }, `${label}, ${each} alone`).toEqual({ painted: each, picked: each });
    // A click on the overlap selects the mark drawn there.
    await page.mouse.click(overlap.x, overlap.y);
    await expect(glyph(later), label).toHaveAttribute('aria-pressed', 'true'); await expect(glyph(earlier), label).toHaveAttribute('aria-pressed', 'false');
    await page.mouse.move(2, 2); await canvas.press('Escape'); await canvas.press('Escape');
    await expect(glyph(later)).toHaveAttribute('aria-pressed', 'false'); expect(await selection(page)).toEqual([]);
  }
});
