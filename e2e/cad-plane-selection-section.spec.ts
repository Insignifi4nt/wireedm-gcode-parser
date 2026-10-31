import type { Page, TestInfo } from '@playwright/test';
import { expect, test } from './fixtures/native-sketch-solver';
import { prepareCadTools, callCadTool as call, cadContext as context } from './cad-tool-helpers';

// Three 10 mm tall blocks below the XY plane, z -30 to -20, all at negative X so the origin planes and axes are clear of them in the
// Top, Front and Right views. Front stands at y < 0 and Back at y > 0; Bar crosses y = 0, so a cut by the XZ plane opens it.
const block = (id: string, x: number, y: number, width: number, depth: number) => [
  { id: `${id}-sketch`, name: `${id} sketch`, kind: 'sketch', suppressed: false, plane: 'XY', offset: -30, profiles: [
    { id: `${id}-outline`, name: `${id} outline`, construction: false, geometry: { kind: 'rectangle', x, y, width, height: depth, cornerRadius: 0 } }] },
  { id, name: id, kind: 'extrude', suppressed: false, sketchId: `${id}-sketch`, distance: 10, symmetric: false, operation: 'new', targetId: null }
];
const features = [...block('front', -40, -30, 10, 20), ...block('back', -40, 10, 10, 20), ...block('bar', -25, -5, 10, 10)];
// The model spans x -40…-15, y -30…30 and z -30…-20, so the origin planes are sized to x -44…12.5, y -36…36 and z -31…12.5 and each
// plane's label sits 2.5 mm inside its far corner: XY at (10, 33.5, 0), XZ at (10, 0, 10) and YZ at (0, 33.5, 10).
const LABELS = { XY: [10, 33.5, 0], XZ: [10, 0, 10], YZ: [0, 33.5, 10] } as const;
type Plane = keyof typeof LABELS;
type View = 'Top' | 'Front' | 'Right';
type Point3 = readonly [number, number, number];
// The world axes each named view shows across and up the screen.
type Axis = 0 | 1 | 2;
const SCREEN: Record<View, readonly [Axis, Axis]> = { Top: [0, 1], Front: [0, 2], Right: [1, 2] };
// The origin plane at zero along each world axis.
const AT_ZERO: Record<Axis, Plane> = { 0: 'YZ', 1: 'XZ', 2: 'XY' };

const model = (page: Page) => page.locator('.cad-viewport:not(.is-sketch-background) .cad-webgl');
const framesDrawn = async (page: Page) => Number(await model(page).getAttribute('data-cad-frames-drawn'));
/** Waits until the model view has drawn and stopped drawing. */
async function settled(page: Page) {
  let last = -1;
  await expect.poll(async () => { const now = await framesDrawn(page); const steady = now > 0 && now === last; last = now; return steady; }, { intervals: [250] }).toBe(true);
}
const viewport = async (page: Page) => call(page, 'cad_get_viewport', { expectedVersion: (await context(page)).version });

/**
 * The page point of a world point in a named view, read from where the view draws the origin plane labels. Each orthographic view
 * shows two world axes at one scale; the two planes seen edge-on place the origin and the third label gives the scale.
 */
async function projection(page: Page, view: View) {
  await call(page, 'cad_set_viewport', { expectedVersion: (await context(page)).version, command: { kind: 'set-view', view } });
  await call(page, 'cad_set_viewport', { expectedVersion: (await context(page)).version, command: { kind: 'fit' } });
  await settled(page);
  const labels = Object.fromEntries(await Promise.all((Object.keys(LABELS) as Plane[]).map(async plane => [plane, await page.locator(`[data-cad-plane-label="principal:${plane}"]`)
    .evaluate(element => { const box = element.parentElement!.getBoundingClientRect(), style = (element as HTMLElement).style; return [box.left + parseFloat(style.left), box.top + parseFloat(style.top)] as const; })] as const))) as Record<Plane, readonly [number, number]>;
  const [across, up] = SCREEN[view];
  // The plane at zero along the screen's across axis is seen edge-on as the vertical line through the origin, and likewise for up.
  const xPlane = AT_ZERO[across], yPlane = AT_ZERO[up];
  const origin = [labels[xPlane][0], labels[yPlane][1]] as const;
  const scaled = (Object.keys(LABELS) as Plane[]).find(plane => plane !== xPlane && LABELS[plane][across] !== 0)!;
  const scale = (labels[scaled][0] - origin[0]) / LABELS[scaled][across];
  const at = (point: Point3) => ({ x: origin[0] + scale * point[across], y: origin[1] - scale * point[up] });
  // Every label must land where this reading puts it, or the plane sizes above no longer hold.
  for (const plane of Object.keys(LABELS) as Plane[]) {
    const expected = at(LABELS[plane]);
    expect(Math.hypot(expected.x - labels[plane][0], expected.y - labels[plane][1]), `${view} ${plane} label ${JSON.stringify({ labels, origin, scale })}`).toBeLessThan(1.5);
  }
  expect(scale).toBeGreaterThan(3);
  return at;
}

/** The mean colour of a 9 × 9 pixel patch at each page point, with the reference geometry hidden so the probes read the part alone. */
async function colours(page: Page, points: Record<string, { x: number; y: number }>, info: TestInfo, shot?: string) {
  const references = page.getByRole('button', { name: 'Show reference geometry', exact: true });
  await openViewControls(page); await references.click(); await expect(references).toHaveAttribute('aria-pressed', 'false');
  await settled(page);
  const path = shot ? info.outputPath(`${shot}.png`) : undefined;
  const png = await page.screenshot(path ? { path } : {});
  await openViewControls(page); await references.click(); await expect(references).toHaveAttribute('aria-pressed', 'true');
  if (path) await info.attach(shot!, { path, contentType: 'image/png' });
  const names = Object.keys(points);
  const values = await page.evaluate(async ({ data, points }) => {
    const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d'); if (!context) throw new Error('Unable to read the page pixels.');
    context.drawImage(image, 0, 0);
    return points.map(({ x, y }) => {
      const { data } = context.getImageData(Math.round(x) - 4, Math.round(y) - 4, 9, 9); const sum = [0, 0, 0];
      for (let index = 0; index < data.length; index += 4) for (let channel = 0; channel < 3; channel++) sum[channel] += data[index + channel];
      return sum.map(value => value / (data.length / 4));
    });
  }, { data: png.toString('base64'), points: names.map(name => points[name]) });
  return Object.fromEntries(names.map((name, index) => [name, values[index]])) as Record<string, number[]>;
}
const brightness = ([red, green, blue]: number[]) => 0.2126 * red + 0.7152 * green + 0.0722 * blue;
// The cap colour is a warm orange, 0xc98a5e; the part and the background are cool greys.
const warmth = ([red, , blue]: number[]) => red - blue;

/** Clicks the model view itself at a page point; a plane label or panel over that point would answer instead. */
async function pick(page: Page, at: { x: number; y: number }) {
  expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.matches('.cad-viewport .cad-webgl canvas') ?? false, at)).toBe(true);
  await page.mouse.move(at.x, at.y); await page.mouse.down(); await page.mouse.up();
}
async function openViewControls(page: Page) {
  const toggle = page.getByRole('button', { name: 'View controls', exact: true });
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
}

test('picks each origin plane, axis and the origin point in 3D, and starts a sketch on a picked plane', async ({ page }) => {
  await prepareCadTools(page); await call(page, 'cad_open_workspace');
  await call(page, 'cad_edit_document', { expectedVersion: (await context(page)).version, edits: features.map(feature => ({ kind: 'add-feature', feature })) });
  const document = await context(page);
  expect((await call(page, 'cad_build', { expectedVersion: document.version })).bodies).toHaveLength(3);
  await expect.poll(async () => (await viewport(page)).view).toMatchObject({ mode: 'solid', available: true, referenceVersion: document.version });
  const picked = async (at: { x: number; y: number }) => {
    await pick(page, at);
    const state = await viewport(page);
    return { plane: state.selectedReferencePlane, origin: state.selectedOrigin ?? null, feature: state.selectedFeatureId };
  };

  const top = await projection(page, 'Top');
  expect(await picked(top([5, 15, 0]))).toEqual({ plane: 'XY', origin: null, feature: null });
  // An axis lying in a plane is picked before the plane; the origin point before the axes through it.
  expect(await picked(top([4, 0, 0]))).toEqual({ plane: null, origin: { kind: 'axis', axis: 'x' }, feature: null });
  expect(await picked(top([0, 15, 0]))).toEqual({ plane: null, origin: { kind: 'axis', axis: 'y' }, feature: null });
  expect(await picked(top([0, 0, 0]))).toEqual({ plane: null, origin: { kind: 'point' }, feature: null });
  // A body in front of the plane wins.
  expect(await picked(top([-35, 20, 0]))).toEqual({ plane: null, origin: null, feature: 'back' });

  const front = await projection(page, 'Front');
  expect(await picked(front([0, 0, 6]))).toEqual({ plane: null, origin: { kind: 'axis', axis: 'z' }, feature: null });
  const right = await projection(page, 'Right');
  expect(await picked(right([0, 15, 5]))).toEqual({ plane: 'YZ', origin: null, feature: null });
  const again = await projection(page, 'Front');
  expect(await picked(again([5, 0, 5]))).toEqual({ plane: 'XZ', origin: null, feature: null });

  // Sketch starts on the picked plane, without asking for one.
  await page.getByRole('button', { name: 'Sketch', exact: true }).click();
  await expect(page.getByLabel('Sketch drawing canvas')).toBeVisible();
  const sketched = await context(page), state = await call(page, 'cad_get_viewport', { expectedVersion: sketched.version });
  expect(state).toMatchObject({ awaitingSketchPlane: false, sketchId: expect.any(String) });
  expect((await call(page, 'cad_get_feature', { expectedVersion: sketched.version, featureId: state.sketchId })).feature).toMatchObject({ kind: 'sketch', plane: 'XZ', offset: 0 });
});

test('cuts a section view by a picked plane, caps it, flips it, picks through the cut and turns off with Escape', async ({ page }, info) => {
  await prepareCadTools(page); await call(page, 'cad_open_workspace');
  await call(page, 'cad_edit_document', { expectedVersion: (await context(page)).version, edits: features.map(feature => ({ kind: 'add-feature', feature })) });
  const document = await context(page);
  expect((await call(page, 'cad_build', { expectedVersion: document.version })).bodies).toHaveLength(3);
  await expect.poll(async () => (await viewport(page)).view).toMatchObject({ mode: 'solid', available: true, referenceVersion: document.version });
  await openViewControls(page);
  const sectionButton = page.getByRole('button', { name: 'Section view', exact: true });
  await expect(sectionButton).toBeDisabled();

  const front = await projection(page, 'Front');
  await pick(page, front([5, 0, 5]));
  await expect.poll(async () => (await viewport(page)).selectedReferencePlane).toBe('XZ');
  await page.screenshot({ path: info.outputPath('picked-xz.png') });
  await openViewControls(page); await sectionButton.click();
  await expect(sectionButton).toHaveAttribute('aria-pressed', 'true');
  let state = await viewport(page);
  expect(state.section).toEqual({ plane: 'XZ', flip: false, caps: true });
  // The XZ normal points to -Y; the section removes that side, so the view keeps points with y >= 0.
  expect(state.view.section).toMatchObject({ caps: true, normal: [0, 1, 0] });
  // In the model view Escape first leaves the plane selection; the section stays. In the open view controls it closes them instead.
  await model(page).locator('canvas').focus(); await page.keyboard.press('Escape');
  await expect.poll(async () => (await viewport(page)).selectedReferencePlane).toBeNull();
  expect((await viewport(page)).section).toEqual({ plane: 'XZ', flip: false, caps: true });

  // Front view: the bar is cut open towards the viewer. Its cap is drawn over the cut; without caps the inside shows.
  const frontProbes = { bar: front([-20, 0, -25]), beside: front([-27.5, 0, -25]) };
  const capped = await colours(page, frontProbes, info, 'section-capped');
  await openViewControls(page); await page.getByRole('checkbox', { name: 'Caps', exact: true }).uncheck();
  await expect.poll(async () => (await viewport(page)).view.section?.caps).toBe(false);
  const open = await colours(page, frontProbes, info, 'section-open');
  await openViewControls(page); await page.getByRole('checkbox', { name: 'Caps', exact: true }).check();
  await call(page, 'cad_set_viewport', { expectedVersion: document.version, command: { kind: 'set-section', on: false } });
  await expect.poll(async () => (await viewport(page)).view.section).toBeUndefined();
  const whole = await colours(page, frontProbes, info, 'section-off');
  const capReport = JSON.stringify({ capped, open, whole });
  expect(warmth(capped.bar), capReport).toBeGreaterThan(60);
  expect(warmth(open.bar), capReport).toBeLessThan(20);
  expect(warmth(whole.bar), capReport).toBeLessThan(20);
  expect(Math.abs(brightness(capped.beside) - brightness(whole.beside)), capReport).toBeLessThan(3);

  // Agents turn the section on by the selected plane through the same operation.
  await call(page, 'cad_set_viewport', { expectedVersion: document.version, command: { kind: 'select-reference-plane', plane: 'XZ' } });
  await call(page, 'cad_set_viewport', { expectedVersion: document.version, command: { kind: 'set-section', on: true } });
  await call(page, 'cad_set_viewport', { expectedVersion: document.version, command: { kind: 'select-reference-plane', plane: null } });
  expect((await viewport(page)).section).toEqual({ plane: 'XZ', flip: false, caps: true });

  // Top view: the cut removes Front, at y < 0, and keeps Back.
  const sides = (at: (point: Point3) => { x: number; y: number }) => ({ front: at([-35, -20, -20]), back: at([-35, 20, -20]) });
  const top = await projection(page, 'Top');
  const cut = await colours(page, sides(top), info, 'section-top');
  // A click on Front's place in the Front view reaches Back behind it, and never the removed block.
  const through = await projection(page, 'Front');
  await pick(page, through([-35, 0, -25]));
  await expect.poll(async () => (await viewport(page)).selectedFeatureId).toBe('back');

  await openViewControls(page); await page.getByRole('button', { name: 'Flip section', exact: true }).click();
  await expect.poll(async () => (await viewport(page)).section).toEqual({ plane: 'XZ', flip: true, caps: true });
  expect((await viewport(page)).view.section).toMatchObject({ normal: [0, -1, 0] });
  await pick(page, through([-35, 0, -25]));
  await expect.poll(async () => (await viewport(page)).selectedFeatureId).toBe('front');
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await viewport(page)).selectedFeatureId).toBeNull();
  const flippedTop = await projection(page, 'Top');
  const flipped = await colours(page, sides(flippedTop), info, 'section-flipped');
  // The same probes over the background alone: every block lies below z = 0, so a section by the XY plane that removes that side
  // leaves nothing of the part. Then the XZ section returns.
  const sectionBy = async (plane: 'XY' | 'XZ') => {
    for (const command of [{ kind: 'select-reference-plane', plane }, { kind: 'set-section', on: true, flip: true }, { kind: 'select-reference-plane', plane: null }])
      await call(page, 'cad_set_viewport', { expectedVersion: document.version, command });
  };
  await sectionBy('XY');
  const empty = await colours(page, sides(flippedTop), info, 'section-empty');
  await sectionBy('XZ');
  expect((await viewport(page)).section).toEqual({ plane: 'XZ', flip: true, caps: true });
  const sideReport = JSON.stringify({ cut, flipped, empty });
  const shown = (probes: Record<string, number[]>, name: string) => brightness(probes[name]) - brightness(empty[name]);
  expect(Math.abs(shown(cut, 'front')), sideReport).toBeLessThan(3);
  expect(shown(cut, 'back'), sideReport).toBeGreaterThan(30);
  expect(Math.abs(shown(flipped, 'back')), sideReport).toBeLessThan(3);
  expect(shown(flipped, 'front'), sideReport).toBeGreaterThan(30);

  // An open sketch shows its own view; the section returns when it closes.
  await call(page, 'cad_set_viewport', { expectedVersion: document.version, command: { kind: 'edit-sketch', sketchId: 'bar-sketch' } });
  await expect(page.getByLabel('Sketch drawing canvas')).toBeVisible();
  await openViewControls(page); await expect(page.getByRole('combobox', { name: /3D background/ })).toBeVisible();
  await expect(sectionButton).toHaveCount(0);
  await call(page, 'cad_set_viewport', { expectedVersion: document.version, command: { kind: 'finish-sketch' } });
  await expect.poll(async () => (await viewport(page)).view.section).toMatchObject({ normal: [0, -1, 0] });

  // Escape leaves the selected body, then turns the section off; the choice is kept on this device until then.
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('wire-edm:cad-preferences:v1') ?? '{}').section)).toMatchObject({ version: 1, plane: 'XZ', flip: true, caps: true });
  const last = await projection(page, 'Front');
  await pick(page, last([-35, 0, -25]));
  await expect.poll(async () => (await viewport(page)).selectedFeatureId).toBe('front');
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await viewport(page)).selectedFeatureId).toBeNull();
  expect((await viewport(page)).section).not.toBeNull();
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await viewport(page)).section).toBeNull();
  await openViewControls(page); await expect(sectionButton).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('wire-edm:cad-preferences:v1') ?? '{}').section)).toBeUndefined();
});
