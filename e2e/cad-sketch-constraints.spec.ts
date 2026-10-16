import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { prepareCadTools, callCadTool as call, rawCadToolCall as rawCall, cadContext as context } from './cad-tool-helpers';

test('draws and constrains fresh geometry through the UI, then extrudes, exports and reopens the exact sketch', async ({ page }) => {
  await prepareCadTools(page); await call(page, 'cad_open_workspace');
  let current = await context(page);
  await expect.poll(() => rawCall(page, 'cad_get_viewport', { expectedVersion: current.version }))
    .toMatchObject({ ok: true, data: { view: { available: true } } });
  await call(page, 'cad_set_viewport', { expectedVersion: current.version, command: { kind: 'select-reference-plane', plane: 'XY' } });
  await page.getByRole('button', { name: 'Sketch', exact: true }).click();
  const canvas = page.getByLabel('Sketch drawing canvas');
  const clickPoint = async (x: number, y: number) => {
    const point = await canvas.evaluate((element, [x, y]) => {
      const matrix = (element as SVGSVGElement).getScreenCTM();
      if (!matrix) throw new Error('Sketch projection unavailable.');
      const point = new DOMPoint(x, -y).matrixTransform(matrix); return { x: point.x, y: point.y };
    }, [x, y]);
    await page.mouse.click(point.x, point.y);
  };
  await clickPoint(0, 0); await clickPoint(40, 25);
  await expect.poll(() => context(page)).toMatchObject({ workflowOpen: false });
  current = await context(page);
  const features = await call(page, 'cad_read_features', { expectedVersion: current.version });
  const sketch = features.items[0];
  expect(sketch.profiles).toEqual([]); expect(sketch.graph.points).toHaveLength(4);
  expect(sketch.graph.relations.map((relation: { kind: string }) => relation.kind)).toEqual(['horizontal', 'vertical', 'horizontal', 'vertical']);
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await expect(page.getByLabel('Sketch constraint status')).toHaveText('4 degrees of freedom');
  await page.getByRole('button', { name: 'Dimension', exact: true }).click();
  await page.getByRole('textbox', { name: 'Length mm', exact: true }).fill('30');
  expect(await context(page)).toMatchObject({ version: current.version, workflowOpen: true });
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect.poll(() => context(page)).toMatchObject({ version: current.version, workflowOpen: false });
  await page.getByRole('button', { name: 'Dimension', exact: true }).click();
  await page.getByRole('textbox', { name: 'Length mm', exact: true }).fill('30');
  await expect(page.getByRole('button', { name: 'Apply', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect.poll(async () => (await context(page)).version).not.toBe(current.version);
  await expect.poll(() => context(page)).toMatchObject({ workflowOpen: false });
  current = await context(page);
  await expect(page.getByLabel('Sketch constraint status')).toHaveText('3 degrees of freedom');
  const resized = (await call(page, 'cad_get_feature', { expectedVersion: current.version, featureId: sketch.id })).feature;
  expect(resized.graph.points.map((point: { id: string }) => point.id)).toEqual(sketch.graph.points.map((point: { id: string }) => point.id));
  expect(resized.graph.relations.at(-1)).toMatchObject({ kind: 'distance', value: 30 });
  expect((await call(page, 'cad_measure_sketch', { expectedVersion: current.version, sketchId: sketch.id })).materialAreaMm2).toBeCloseTo(750, 7);
  const xs = resized.graph.points.map((point: { position: number[] }) => point.position[0]);
  const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
  await page.getByRole('button', { name: 'Circle', exact: true }).click();
  await clickPoint(centerX, 10); await clickPoint(centerX + 5, 10);
  await expect.poll(async () => (await context(page)).version).not.toBe(current.version);
  await expect.poll(() => context(page)).toMatchObject({ workflowOpen: false });
  current = await context(page);
  const accepted = (await call(page, 'cad_get_feature', { expectedVersion: current.version, featureId: sketch.id })).feature;
  expect(accepted.graph.entities.at(-1)).toMatchObject({ kind: 'circle', radius: 5 });
  const area = 750 - Math.PI * 25;
  expect((await call(page, 'cad_measure_sketch', { expectedVersion: current.version, sketchId: sketch.id })).materialAreaMm2).toBeCloseTo(area, 7);
  await page.getByRole('button', { name: 'Finish sketch', exact: true }).click();
  await page.getByRole('button', { name: 'Pad / Pocket', exact: true }).click();
  await page.getByRole('textbox', { name: 'Length mm', exact: true }).fill('5');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect.poll(async () => (await context(page)).version).not.toBe(current.version);
  await expect.poll(() => context(page)).toMatchObject({ workflowOpen: false });
  current = await context(page);
  const built = await call(page, 'cad_build', { expectedVersion: current.version });
  expect(built.diagnostics).toEqual([]); expect(built.bodies[0].volumeMm3).toBeCloseTo(area * 5, 6);
  await page.getByRole('button', { name: 'File', exact: true }).click();
  const downloading = page.waitForEvent('download'); await page.getByRole('menuitem', { name: 'Export STEP', exact: true }).click();
  const path = await (await downloading).path(); if (!path) throw new Error('STEP download missing.');
  expect((await readFile(path, 'utf8')).startsWith('ISO-10303-21;')).toBe(true);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => context(page)).toMatchObject({ dirty: false }); await page.reload();
  await expect(page.getByRole('main', { name: 'Parametric CAD workbench' })).toBeVisible();
  const reopened = await context(page);
  expect((await call(page, 'cad_get_feature', { expectedVersion: reopened.version, featureId: sketch.id })).feature).toEqual(accepted);
});

test('moves one shared graph point over an enclosing profile, with cancel, undo and keyboard editing', async ({ page }) => {
  await prepareCadTools(page); await call(page, 'cad_open_workspace');
  await call(page, 'cad_edit_document', { expectedVersion: (await context(page)).version, edits: [{ kind: 'add-feature', feature: {
    id: 'outline', kind: 'sketch', name: 'Outline', suppressed: false, plane: 'XY', offset: 0,
    profiles: [{ id: 'outer', name: 'Outer', construction: false, geometry: { kind: 'rectangle', x: -5, y: -10, width: 40, height: 30, cornerRadius: 0 } }],
    graph: { points: [{ id: 'a', position: ['0', '0'] }, { id: 'b', position: [20, 0] }, { id: 'c', position: [20, 10] }, { id: 'd', position: [0, 10] }],
      entities: [
        { id: 'ab', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' },
        { id: 'bc', kind: 'line', construction: false, startPointId: 'b', endPointId: 'c' },
        { id: 'cd', kind: 'line', construction: false, startPointId: 'c', endPointId: 'd' },
        { id: 'da', kind: 'line', construction: false, startPointId: 'd', endPointId: 'a' }
      ], relations: [] }
  } }] });
  const initial = await context(page);
  await expect.poll(() => rawCall(page, 'cad_get_viewport', { expectedVersion: initial.version }))
    .toMatchObject({ ok: true, data: { view: { available: true, referenceVersion: initial.version } } });
  await call(page, 'cad_set_viewport', { expectedVersion: initial.version, command: { kind: 'edit-sketch', sketchId: 'outline' } });
  const point = page.getByRole('button', { name: 'Point 2 in Outline', exact: true });
  const box = await point.boundingBox();
  const scale = await page.getByLabel('Sketch drawing canvas').evaluate(element => {
    const canvas = element as SVGSVGElement, bounds = canvas.getBoundingClientRect();
    return { x: bounds.width / canvas.viewBox.baseVal.width, y: bounds.height / canvas.viewBox.baseVal.height };
  });
  if (!box) throw new Error('Missing graph point.');
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const drag = async () => {
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    await page.mouse.move(start.x + 5 * scale.x, start.y - 5 * scale.y, { steps: 4 });
  };
  await drag();
  expect(await context(page)).toMatchObject({ version: initial.version, workflowOpen: true });
  await page.keyboard.press('Escape'); await page.mouse.up();
  await expect.poll(() => context(page)).toMatchObject({ version: initial.version, workflowOpen: false });
  await drag(); await page.mouse.up();
  await expect.poll(async () => (await context(page)).version).not.toBe(initial.version);
  await expect.poll(() => context(page)).toMatchObject({ workflowOpen: false });
  await expect(point).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Select Outer profile', exact: true })).toHaveAttribute('aria-pressed', 'false');
  const source = async () => call(page, 'cad_get_feature', { expectedVersion: (await context(page)).version, featureId: 'outline' });
  expect(await source()).toMatchObject({ feature: {
    profiles: [{ geometry: { x: -5, y: -10, width: 40, height: 30 } }],
    graph: { points: [{ id: 'a', position: ['0', '0'] }, { id: 'b', position: [25, 5] }, { id: 'c', position: [20, 10] }, { id: 'd', position: [0, 10] }] }
  } });
  await page.keyboard.press('Control+z');
  await expect.poll(source).toMatchObject({ feature: { graph: { points: [{ position: ['0', '0'] }, { position: [20, 0] }, { position: [20, 10] }, { position: [0, 10] }] } } });
  const beforeNudge = (await context(page)).version;
  await point.press('ArrowRight');
  await expect.poll(async () => (await context(page)).version).not.toBe(beforeNudge);
  await expect.poll(() => context(page)).toMatchObject({ workflowOpen: false });
  expect(await source()).toMatchObject({ feature: { graph: { points: [{ position: ['0', '0'] }, { position: [25, 0] }, { position: [20, 10] }, { position: [0, 10] }] } } });
  const beforeLocked = (await context(page)).version;
  await page.getByRole('button', { name: 'Point 1 in Outline', exact: true }).press('ArrowRight');
  expect(await context(page)).toMatchObject({ version: beforeLocked, workflowOpen: false });
  await point.press('Delete');
  await expect.poll(async () => (await context(page)).version).not.toBe(beforeLocked);
  await expect.poll(() => context(page)).toMatchObject({ workflowOpen: false });
  const deleted = await source();
  expect(deleted.feature.graph.points.map((item: { id: string }) => item.id)).toEqual(['a', 'c', 'd']);
  expect(deleted.feature.graph.entities.map((item: { id: string }) => item.id)).toEqual(['cd', 'da']);
  expect(deleted.feature.profiles).toHaveLength(1);
  await page.keyboard.press('Control+z');
  await expect.poll(source).toMatchObject({ feature: { graph: { points: [{ position: ['0', '0'] }, { position: [25, 0] }, { position: [20, 10] }, { position: [0, 10] }] } } });
});

test('keeps an authored path open, moves one joint and closes a separate analytic line-arc boundary', async ({ page }) => {
  await prepareCadTools(page); await call(page, 'cad_open_workspace');
  let current = await context(page);
  await expect.poll(() => rawCall(page, 'cad_get_viewport', { expectedVersion: current.version }))
    .toMatchObject({ ok: true, data: { view: { available: true } } });
  await call(page, 'cad_set_viewport', { expectedVersion: current.version, command: { kind: 'select-reference-plane', plane: 'XY' } });
  await page.getByRole('button', { name: 'Sketch', exact: true }).click();
  await page.getByRole('button', { name: 'Path', exact: true }).click();
  const canvas = page.getByLabel('Sketch drawing canvas');
  const clickPoint = async (x: number, y: number) => {
    const point = await canvas.evaluate((element, [x, y]) => {
      const matrix = (element as SVGSVGElement).getScreenCTM();
      if (!matrix) throw new Error('Sketch projection unavailable.');
      const point = new DOMPoint(x, -y).matrixTransform(matrix); return { x: point.x, y: point.y };
    }, [x, y]);
    await page.mouse.click(point.x, point.y);
  };
  await clickPoint(0, 0); await clickPoint(20, 0); await clickPoint(20, 20);
  await page.getByRole('button', { name: 'Finish path', exact: true }).click();
  await expect.poll(() => context(page)).toMatchObject({ workflowOpen: false }); current = await context(page);
  const sketch = (await call(page, 'cad_read_features', { expectedVersion: current.version })).items[0];
  expect(sketch.graph.entities).toHaveLength(2); expect(sketch.graph.points.map((point: { position: number[] }) => point.position)).toEqual([[0, 0], [20, 0], [20, 20]]);
  expect((await call(page, 'cad_measure_sketch', { expectedVersion: current.version, sketchId: sketch.id })).materialAreaMm2).toBe(0);
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await page.getByRole('button', { name: `Point 2 in ${sketch.name}`, exact: true }).press('ArrowRight');
  await expect.poll(async () => (await context(page)).version).not.toBe(current.version);
  await expect.poll(() => context(page)).toMatchObject({ workflowOpen: false }); current = await context(page);
  await expect(page.getByLabel('Sketch constraint status')).toHaveText('6 degrees of freedom');
  expect((await call(page, 'cad_get_feature', { expectedVersion: current.version, featureId: sketch.id })).feature.graph.points.map((point: { position: number[] }) => point.position))
    .toEqual([[0, 0], [25, 0], [20, 20]]);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await context(page)).version).not.toBe(current.version);
  current = await context(page);
  await page.getByRole('button', { name: 'Path', exact: true }).click();
  await clickPoint(40, 0); await clickPoint(60, 0);
  await page.getByRole('button', { name: '3-point Arc', exact: true }).click();
  await clickPoint(60, 20); await clickPoint(70, 10);
  await page.getByRole('button', { name: 'Line', exact: true }).click(); await clickPoint(40, 20);
  await page.getByRole('button', { name: 'Close profile', exact: true }).click();
  await expect.poll(async () => (await context(page)).version).not.toBe(current.version);
  await expect.poll(() => context(page)).toMatchObject({ workflowOpen: false }); current = await context(page);
  const accepted = (await call(page, 'cad_get_feature', { expectedVersion: current.version, featureId: sketch.id })).feature;
  expect(accepted.graph.entities.map((entity: { kind: string }) => entity.kind)).toEqual(['line', 'line', 'line', 'arc', 'line', 'line']);
  expect(accepted.graph.points.slice(0, 3)).toEqual(sketch.graph.points);
  const area = 400 + 50 * Math.PI;
  expect((await call(page, 'cad_measure_sketch', { expectedVersion: current.version, sketchId: sketch.id })).materialAreaMm2).toBeCloseTo(area, 7);
  await page.getByRole('button', { name: 'Finish sketch', exact: true }).click();
  await page.getByRole('button', { name: 'Pad / Pocket', exact: true }).click();
  await page.getByRole('textbox', { name: 'Length mm', exact: true }).fill('5'); await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect.poll(async () => (await context(page)).version).not.toBe(current.version);
  await expect.poll(() => context(page)).toMatchObject({ workflowOpen: false }); current = await context(page);
  const built = await call(page, 'cad_build', { expectedVersion: current.version });
  expect(built.diagnostics).toEqual([]); expect(built.bodies[0].volumeMm3).toBeCloseTo(area * 5, 6);
});

test('edits graph relations and linked circle radius through the shared inspector with honest freedom and edge-only picking', async ({ page }) => {
  await prepareCadTools(page); await call(page, 'cad_open_workspace');
  await call(page, 'cad_edit_document', { expectedVersion: (await context(page)).version, edits: [
    { kind: 'set-parameter', name: 'radius', value: 10 },
    { kind: 'add-feature', feature: { id: 'outline', kind: 'sketch', name: 'Outline', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: {
      points: [{ id: 'center', position: ['0', '0'] }, { id: 'a', position: ['30', '0'] }, { id: 'b', position: [40, 5] }],
      entities: [{ id: 'ring', kind: 'circle', construction: false, centerPointId: 'center', radius: ' radius ' },
        { id: 'ab', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' }], relations: []
    } } }
  ] });
  let current = await context(page);
  await expect.poll(() => rawCall(page, 'cad_get_viewport', { expectedVersion: current.version }))
    .toMatchObject({ ok: true, data: { view: { available: true, referenceVersion: current.version } } });
  await call(page, 'cad_set_viewport', { expectedVersion: current.version, command: { kind: 'edit-sketch', sketchId: 'outline' } });
  await expect(page.getByLabel('Sketch constraint status')).toHaveText('2 degrees of freedom');
  await call(page, 'cad_set_viewport', { expectedVersion: current.version, command: { kind: 'select-sketch-geometry', selection: { kind: 'entity', id: 'ring' } } });
  const ring = page.locator('[data-cad-sketch-entity="ring"] > circle');
  const interior = await ring.evaluate(element => {
    const circle = element as SVGCircleElement, matrix = circle.getScreenCTM();
    if (!matrix) throw new Error('Circle projection is unavailable.');
    const point = new DOMPoint(circle.cx.baseVal.value + 4, circle.cy.baseVal.value + 4).matrixTransform(matrix);
    return { x: point.x, y: point.y };
  });
  await page.mouse.click(interior.x, interior.y);
  expect((await call(page, 'cad_get_viewport', { expectedVersion: current.version })).selectedSketchGeometry).toBeUndefined();
  await call(page, 'cad_set_viewport', { expectedVersion: current.version, command: { kind: 'select-sketch-geometry', selection: { kind: 'entity', id: 'ab' } } });
  await page.getByRole('checkbox', { name: 'Horizontal', exact: true }).check();
  const endY = () => page.locator('[data-cad-sketch-entity="ab"] > line').evaluate(line => Number(line.getAttribute('y2')) - Number(line.getAttribute('y1')));
  await expect.poll(endY).toBeCloseTo(0, 9);
  expect((await context(page)).version).toBe(current.version);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click(); await expect.poll(endY).toBeCloseTo(5, 9);
  await page.getByRole('checkbox', { name: 'Horizontal', exact: true }).check(); await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect.poll(async () => (await context(page)).version).not.toBe(current.version);
  await expect.poll(() => context(page)).toMatchObject({ workflowOpen: false });
  current = await context(page);
  await expect(page.getByLabel('Sketch constraint status')).toHaveText('1 degree of freedom');
  expect((await call(page, 'cad_get_viewport', { expectedVersion: current.version })).selectedSketchGeometry).toEqual({ kind: 'entity', id: 'ab' });
  await page.getByRole('button', { name: 'Add length', exact: true }).click();
  await page.getByRole('textbox', { name: 'Length mm', exact: true }).fill('15'); await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect.poll(async () => (await context(page)).version).not.toBe(current.version);
  await expect.poll(() => context(page)).toMatchObject({ workflowOpen: false });
  current = await context(page);
  await expect(page.getByLabel('Sketch constraint status')).toHaveText('Fully constrained');
  await expect(page.getByRole('button', { name: 'Point 3 in Outline', exact: true })).toHaveAttribute('aria-disabled', 'true');
  const inspection = await call(page, 'cad_inspect_sketch_constraints', { expectedVersion: current.version, sketchId: 'outline' });
  expect(inspection.analysis).toMatchObject({ kind: 'solved', degreesOfFreedom: 0 });
  const feature = await call(page, 'cad_get_feature', { expectedVersion: current.version, featureId: 'outline' });
  expect(feature.feature.graph.points[2].position[0]).toBeCloseTo(45, 8);
  await page.getByRole('button', { name: 'Configure distance 15 mm', exact: true }).click();
  await page.getByRole('textbox', { name: 'Length mm', exact: true }).fill('17.5');
  await expect.poll(() => page.locator('[data-cad-sketch-entity="ab"] > line').evaluate(line => Number(line.getAttribute('x2')) - Number(line.getAttribute('x1')))).toBeCloseTo(17.5, 9);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Configure distance 15 mm', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Length mm', exact: true })).toHaveValue('15');
  expect((await context(page)).version).toBe(current.version);
  await call(page, 'cad_set_viewport', { expectedVersion: current.version, command: { kind: 'select-sketch-geometry', selection: { kind: 'entity', id: 'ring' } } });
  await page.getByRole('textbox', { name: 'Radius mm', exact: true }).fill('12.5'); await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect.poll(async () => (await context(page)).version).not.toBe(current.version);
  await expect.poll(() => context(page)).toMatchObject({ workflowOpen: false });
  current = await context(page);
  expect((await call(page, 'cad_get_feature', { expectedVersion: current.version, featureId: 'outline' })).feature.graph.entities[0].radius).toBe(' radius ');
  expect((await call(page, 'cad_inspect_parameters', { expectedVersion: current.version })).items).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'radius', value: 12.5 })]));
});

test('previews and applies a linked size across legacy and solved sketch geometry, with cancel and undo', async ({ page }) => {
  await prepareCadTools(page); await call(page, 'cad_open_workspace');
  await call(page, 'cad_edit_document', { expectedVersion: (await context(page)).version, edits: [
    { kind: 'set-parameter', name: 'width', value: 20 },
    { kind: 'add-feature', feature: { id: 'outline', kind: 'sketch', name: 'Linked geometry', suppressed: false, plane: 'XY', offset: 0,
      profiles: [{ id: 'plate', name: 'Plate', construction: false, constraints: [{ id: 'width-dimension', kind: 'dimension', quantity: 'width' }],
        geometry: { kind: 'rectangle', x: 40, y: 0, width: ' width ', height: 5, cornerRadius: 0 } }],
      graph: { points: [{ id: 'a', position: ['0', '0'] }, { id: 'b', position: [20, 0] }],
        entities: [{ id: 'ab', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' }],
        relations: [{ id: 'horizontal', kind: 'horizontal', pointIds: ['a', 'b'] }, { id: 'length', kind: 'distance', pointIds: ['a', 'b'], value: 'width' }] } } }
  ] });
  const initial = await context(page);
  await expect.poll(() => rawCall(page, 'cad_get_viewport', { expectedVersion: initial.version }))
    .toMatchObject({ ok: true, data: { view: { available: true, referenceVersion: initial.version } } });
  await call(page, 'cad_set_viewport', { expectedVersion: initial.version, command: { kind: 'edit-sketch', sketchId: 'outline' } });
  await call(page, 'cad_set_viewport', { expectedVersion: initial.version, command: { kind: 'select-profile', profileId: 'plate' } });
  const length = () => page.locator('[data-cad-sketch-entity="ab"] > line').evaluate(line => Number(line.getAttribute('x2')) - Number(line.getAttribute('x1')));
  await expect.poll(length).toBeCloseTo(20, 9);
  await page.getByRole('button', { name: 'Configure Width dimension', exact: true }).click();
  await page.getByRole('textbox', { name: 'Dimension value', exact: true }).fill('30');
  await expect.poll(length).toBeCloseTo(30, 9);
  await expect(page.getByLabel('Sketch measurements').locator('dd').first()).toHaveText('150 mm²');
  expect(await context(page)).toMatchObject({ version: initial.version, workflowOpen: true });
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect.poll(length).toBeCloseTo(20, 9); expect((await context(page)).version).toBe(initial.version);
  await page.getByRole('button', { name: 'Configure Width dimension', exact: true }).click();
  await page.getByRole('textbox', { name: 'Dimension value', exact: true }).fill('30');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect.poll(() => context(page)).toMatchObject({ workflowOpen: false });
  const current = await context(page); expect(current.version).not.toBe(initial.version);
  await expect.poll(length).toBeCloseTo(30, 9);
  const accepted = await call(page, 'cad_get_feature', { expectedVersion: current.version, featureId: 'outline' });
  expect(accepted.feature.profiles[0].geometry.width).toBe(' width '); expect(accepted.feature.graph.points[1].position[0]).toBeCloseTo(30, 9);
  await page.keyboard.press('Control+z'); await expect.poll(length).toBeCloseTo(20, 9);
});

test('solves a saved entity sketch through WebMCP, rejects conflicts and exports its exact extrusion', async ({ page }) => {
  const nativeRequests: string[] = [];
  page.on('request', request => { if (request.url().endsWith('.wasm')) nativeRequests.push(request.url()); });
  await prepareCadTools(page);
  await call(page, 'cad_open_workspace');
  const initial = await context(page);
  expect(nativeRequests.some(url => url.includes('planegcs'))).toBe(false);
  await call(page, 'cad_edit_document', { expectedVersion: initial.version, edits: [
    { kind: 'set-parameter', name: 'width', value: 20 },
    { kind: 'add-feature', feature: { kind: 'sketch', id: 'outline', name: 'Constrained outline', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: {
      points: [{ id: 'a', position: ['0', '0'] }, { id: 'b', position: [20, 0] }, { id: 'c', position: [20, 10] }, { id: 'd', position: [0, 10] }],
      entities: [
        { id: 'ab', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' },
        { id: 'bc', kind: 'line', construction: false, startPointId: 'b', endPointId: 'c' },
        { id: 'cd', kind: 'line', construction: false, startPointId: 'c', endPointId: 'd' },
        { id: 'da', kind: 'line', construction: false, startPointId: 'd', endPointId: 'a' }
      ], relations: [
        { id: 'h1', kind: 'horizontal', pointIds: ['a', 'b'] }, { id: 'v1', kind: 'vertical', pointIds: ['b', 'c'] },
        { id: 'h2', kind: 'horizontal', pointIds: ['c', 'd'] }, { id: 'v2', kind: 'vertical', pointIds: ['d', 'a'] },
        { id: 'width', kind: 'distance', pointIds: ['a', 'b'], value: ' width ' }, { id: 'height', kind: 'distance', pointIds: ['a', 'd'], value: 10 }
      ]
    } } }
  ] });
  let current = await context(page);
  await call(page, 'cad_edit_document', { expectedVersion: current.version, edits: [{ kind: 'set-parameter', name: 'width', value: 30 }] });
  current = await context(page);
  const accepted = await call(page, 'cad_get_feature', { expectedVersion: current.version, featureId: 'outline' });
  expect(accepted.feature.graph.points[0].position).toEqual(['0', '0']);
  expect(accepted.feature.graph.points[1].position[0]).toBeCloseTo(30, 9);
  expect(accepted.feature.graph.points[2].position[0]).toBeCloseTo(30, 9);
  expect(accepted.feature.graph.relations[4].value).toBe(' width ');
  const conflict = await rawCall(page, 'cad_edit_document', { expectedVersion: current.version, edits: [
    { kind: 'set-sketch-relation', sketchId: 'outline', relation: { id: 'conflict', kind: 'distance', pointIds: ['a', 'b'], value: 10 } }
  ] });
  expect(conflict.ok).toBe(false); expect((await context(page)).version).toBe(current.version);
  expect(nativeRequests.filter(url => url.includes('planegcs'))).toHaveLength(1);
  expect(nativeRequests.some(url => url.includes('replicad_single') || url.includes('occt-import-js'))).toBe(false);
  await call(page, 'cad_edit_document', { expectedVersion: current.version, edits: [{ kind: 'add-feature', feature: {
    id: 'pad', kind: 'extrude', name: 'Plate', suppressed: false, sketchId: 'outline', distance: 5, symmetric: false, operation: 'new', targetId: null
  } }] });
  current = await context(page);
  const built = await call(page, 'cad_build', { expectedVersion: current.version });
  expect(built.diagnostics).toEqual([]);
  expect(built.bodies[0].volumeMm3).toBeCloseTo(1500, 7);
  const downloadPromise = page.waitForEvent('download');
  await call(page, 'cad_export_solid', { expectedVersion: current.version, format: 'step' });
  const download = await downloadPromise, path = await download.path();
  if (!path) throw new Error('STEP download is missing.');
  expect((await readFile(path, 'utf8')).startsWith('ISO-10303-21;')).toBe(true);
  await call(page, 'cad_save_document', { expectedVersion: current.version });
  await page.reload();
  await expect(page.getByRole('main', { name: 'Parametric CAD workbench' })).toBeVisible();
  const reopened = await context(page);
  expect(reopened).toMatchObject({ documentId: current.documentId, dirty: false });
  expect((await call(page, 'cad_get_feature', { expectedVersion: reopened.version, featureId: 'outline' })).feature).toEqual(accepted.feature);
});

test('edits a consumed sketch privately with local history, rejected Finish, exact Cancel and one final part undo', async ({ page }) => {
  await prepareCadTools(page); await call(page, 'cad_open_workspace');
  await call(page, 'cad_edit_document', { expectedVersion: (await context(page)).version, edits: [
    { kind: 'add-feature', feature: { id: 'outline', kind: 'sketch', name: 'Outline', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: {
      points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [20, 0] }, { id: 'c', position: [20, 10] }, { id: 'd', position: [0, 10] }],
      entities: [
        { id: 'ab', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' },
        { id: 'bc', kind: 'line', construction: false, startPointId: 'b', endPointId: 'c' },
        { id: 'cd', kind: 'line', construction: false, startPointId: 'c', endPointId: 'd' },
        { id: 'da', kind: 'line', construction: false, startPointId: 'd', endPointId: 'a' }
      ], relations: []
    } } },
    { kind: 'add-feature', feature: { id: 'pad', kind: 'extrude', name: 'Pad', suppressed: false, sketchId: 'outline', distance: 5, symmetric: false, operation: 'new', targetId: null } }
  ] });
  const base = await context(page), original = (await call(page, 'cad_get_feature', { expectedVersion: base.version, featureId: 'outline' })).feature;
  await call(page, 'cad_build', { expectedVersion: base.version });
  await expect.poll(() => rawCall(page, 'cad_get_viewport', { expectedVersion: base.version }))
    .toMatchObject({ ok: true, data: { view: { available: true, referenceVersion: base.version } } });
  const openEdit = async () => {
    await page.getByRole('button', { name: 'Select Outline in history', exact: true }).dblclick();
    await expect(page.getByRole('button', { name: 'Cancel sketch edits', exact: true })).toBeVisible();
  };
  await openEdit();
  expect(await context(page)).toMatchObject({ version: base.version, workflowOpen: true });
  expect((await rawCall(page, 'cad_edit_document', { expectedVersion: base.version, edits: [{ kind: 'rename-document', name: 'Concurrent agent' }] })).ok).toBe(false);
  expect(await page.getByRole('button', { name: 'Save', exact: true }).isEnabled()).toBe(false);
  await page.getByRole('textbox', { name: 'Plane offset mm', exact: true }).fill('2');
  await expect(page.getByRole('button', { name: 'Apply', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Apply', exact: true })).toHaveCount(0);
  expect((await call(page, 'cad_get_feature', { expectedVersion: base.version, featureId: 'outline' })).feature).toEqual(original);
  await page.getByRole('button', { name: 'Line 2 in Outline', exact: true }).press('Delete');
  await expect(page.locator('[data-cad-sketch-entity]')).toHaveCount(3);
  expect((await call(page, 'cad_get_feature', { expectedVersion: base.version, featureId: 'outline' })).feature).toEqual(original);
  await page.getByRole('button', { name: 'Finish sketch', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Finish sketch', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Cancel sketch edits', exact: true })).toBeVisible();
  expect(await context(page)).toMatchObject({ version: base.version, workflowOpen: true });
  await page.keyboard.press('Control+z'); await expect(page.locator('[data-cad-sketch-entity]')).toHaveCount(4);
  await page.getByRole('button', { name: 'Point 2 in Outline', exact: true }).press('ArrowRight');
  await expect(page.locator('[data-cad-sketch-point="b"] title')).toHaveText(/25, 0 mm/);
  expect((await call(page, 'cad_get_feature', { expectedVersion: base.version, featureId: 'outline' })).feature).toEqual(original);
  await page.getByRole('button', { name: 'Cancel sketch edits', exact: true }).click();
  await expect(page.getByLabel('3D model viewport')).toBeVisible();
  await expect.poll(() => context(page)).toMatchObject({ version: base.version, workflowOpen: false });
  expect((await call(page, 'cad_get_feature', { expectedVersion: base.version, featureId: 'outline' })).feature).toEqual(original);
  await openEdit();
  await page.getByRole('button', { name: 'Line 2 in Outline', exact: true }).press('Delete');
  await expect(page.locator('[data-cad-sketch-entity]')).toHaveCount(3);
  const endpoints = [];
  for (const id of ['b', 'c']) {
    const box = await page.locator(`[data-cad-sketch-point="${id}"]`).boundingBox();
    if (!box) throw new Error('Sketch endpoint unavailable.');
    endpoints.push({ x: box.x + box.width / 2 + 1, y: box.y + box.height / 2 + 1 });
  }
  await page.getByRole('button', { name: 'Path', exact: true }).click();
  for (const point of endpoints) await page.mouse.click(point.x, point.y);
  await page.getByRole('button', { name: 'Finish path', exact: true }).click();
  await expect(page.locator('[data-cad-sketch-entity]')).toHaveCount(4);
  expect((await call(page, 'cad_get_feature', { expectedVersion: base.version, featureId: 'outline' })).feature).toEqual(original);
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await expect(page.locator('[data-cad-sketch-point]')).toHaveCount(4);
  await page.getByRole('button', { name: 'Point 2 in Outline', exact: true }).press('ArrowRight');
  await expect(page.locator('[data-cad-sketch-point="b"] title')).toHaveText(/25, 0 mm/);
  await page.getByRole('button', { name: 'Finish sketch', exact: true }).click();
  await expect(page.getByLabel('3D model viewport')).toBeVisible();
  await expect.poll(async () => (await context(page)).version).not.toBe(base.version);
  await expect.poll(() => context(page)).toMatchObject({ workflowOpen: false });
  const changed = await context(page), built = await call(page, 'cad_build', { expectedVersion: changed.version });
  expect(built.diagnostics).toEqual([]); expect(built.bodies[0].volumeMm3).toBeCloseTo(1125, 7);
  await page.keyboard.press('Control+z');
  const undone = await context(page);
  expect((await call(page, 'cad_get_feature', { expectedVersion: undone.version, featureId: 'outline' })).feature).toEqual(original);
});
