import { expect, test } from './fixtures/native-sketch-solver';
import { prepareCadTools, callCadTool as call, rawCadToolCall as rawCall, cadContext as context, enableGridSnap } from './cad-tool-helpers';

test('chains clicked lines until a double-click, saves a dragged line at once, and Escape finishes before it leaves the tool', async ({ page }) => {
  await prepareCadTools(page); await call(page, 'cad_open_workspace');
  const blank = await context(page);
  await expect.poll(() => rawCall(page, 'cad_get_viewport', { expectedVersion: blank.version })).toMatchObject({ ok: true, data: { view: { available: true } } });
  await call(page, 'cad_set_viewport', { expectedVersion: blank.version, command: { kind: 'select-reference-plane', plane: 'XY' } });
  await page.getByRole('button', { name: 'Sketch', exact: true }).click();
  await enableGridSnap(page);
  const canvas = page.getByLabel('Sketch drawing canvas');
  const project = (x: number, y: number) => canvas.evaluate((element, [x, y]) => {
    const matrix = (element as SVGSVGElement).getScreenCTM(); if (!matrix) throw new Error('Sketch projection unavailable.');
    const point = new DOMPoint(x, -y).matrixTransform(matrix); return { x: point.x, y: point.y };
  }, [x, y]);
  const clickPoint = async (x: number, y: number) => { const point = await project(x, y); await page.mouse.click(point.x, point.y); };
  const graph = async () => {
    await expect.poll(() => context(page)).toMatchObject({ workflowOpen: false });
    const current = await context(page);
    return { version: current.version, graph: (await call(page, 'cad_read_features', { expectedVersion: current.version })).items[0].graph ?? { points: [], entities: [], relations: [] } };
  };
  const line = page.getByRole('button', { name: 'Line', exact: true }), select = page.getByRole('button', { name: 'Select', exact: true });
  const opened = await context(page);

  // P, the former Polyline shortcut, picks the chaining Line.
  await canvas.focus(); await page.keyboard.press('p'); await expect(line).toHaveAttribute('aria-pressed', 'true');
  await clickPoint(10, 10); await clickPoint(30, 10); await clickPoint(30, 30);
  expect(await context(page)).toMatchObject({ version: opened.version, workflowOpen: true });
  const end = await project(30, 30); await page.mouse.dblclick(end.x, end.y);
  let saved = await graph();
  expect(saved.graph.points.map((point: { position: number[] }) => point.position)).toEqual([[10, 10], [30, 10], [30, 30]]);
  const [first, second] = saved.graph.entities;
  expect([first.kind, second.kind]).toEqual(['line', 'line']); expect(first.endPointId).toBe(second.startPointId);
  await expect(line).toHaveAttribute('aria-pressed', 'true');

  // A drag with nothing pending saves one line and stays in Line.
  const from = await project(10, 40), to = await project(30, 40);
  await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 6 }); await page.mouse.up();
  saved = await graph(); expect(saved.graph.entities).toHaveLength(3); await expect(line).toHaveAttribute('aria-pressed', 'true');

  // Escape saves the completed segments, and the next Escape, with nothing pending, returns to Select.
  await clickPoint(50, 10); await clickPoint(60, 10); await page.keyboard.press('Escape');
  saved = await graph(); expect(saved.graph.entities).toHaveLength(4); await expect(line).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape'); await expect(select).toHaveAttribute('aria-pressed', 'true');

  // A lone start is discarded by Escape without an edit.
  await line.click(); await clickPoint(50, 40); expect(await context(page)).toMatchObject({ workflowOpen: true });
  await page.keyboard.press('Escape'); await expect.poll(() => context(page)).toMatchObject({ version: saved.version, workflowOpen: false });
  await expect(line).toHaveAttribute('aria-pressed', 'true');

  // A tool switch saves the pending chain open first, then changes tool.
  await clickPoint(70, 10); await clickPoint(80, 10); await clickPoint(80, 20);
  await page.getByRole('button', { name: 'Arc', exact: true }).click();
  saved = await graph(); expect(saved.graph.entities).toHaveLength(6);
  await expect(page.getByRole('button', { name: 'Arc', exact: true })).toHaveAttribute('aria-pressed', 'true');

  // Each chain was one edit: undo removes the last one whole.
  await page.keyboard.press('Control+z'); saved = await graph(); expect(saved.graph.entities).toHaveLength(4);
});
