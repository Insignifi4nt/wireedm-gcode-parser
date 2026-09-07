import { expect, test, type Page } from '@playwright/test';
import { confirmPendingDxfImport } from './dxf-import';

test.use({ hasTouch: true });

async function openRectangle(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Go Build!', exact: true }).click();
  await page.getByLabel('DXF file').setInputFiles('examples/robofil-100-v2/no-lead-rectangle.dxf');
  await confirmPendingDxfImport(page);
}

async function screenPoint(page: Page, world = { x: 0, y: 0 }) {
  return page.locator('[data-preview-grid-layer]').evaluate((grid, world) => {
    if (!(grid instanceof SVGGraphicsElement)) throw new Error('Missing grid');
    const matrix = grid.getScreenCTM();
    if (!matrix) throw new Error('Missing transform');
    const point = new DOMPoint(world.x, world.y).matrixTransform(matrix);
    return { x: point.x, y: point.y };
  }, world);
}

test('wheel zoom retains the cursor anchor, clamps, and fits without editing', async ({ page }) => {
  await openRectangle(page);
  const initial = await screenPoint(page);
  // Native wheel events quantize client coordinates. Anchor on an integer pixel
  // and verify the world point actually beneath it, rather than a nearby origin.
  const cursor = { x: Math.round(initial.x), y: Math.round(initial.y) };
  const anchor = await page.locator('[data-preview-grid-layer]').evaluate((grid, cursor) => {
    const matrix = (grid as SVGGraphicsElement).getScreenCTM();
    if (!matrix) throw new Error('Missing transform');
    const point = new DOMPoint(cursor.x, cursor.y).matrixTransform(matrix.inverse());
    return { x: point.x, y: point.y };
  }, cursor);
  await page.mouse.move(cursor.x, cursor.y);
  await page.mouse.wheel(0, -100);
  await expect.poll(async () => Math.abs((await screenPoint(page, anchor)).x - cursor.x)).toBeLessThan(0.1);
  await expect.poll(async () => Math.abs((await screenPoint(page, anchor)).y - cursor.y)).toBeLessThan(0.1);
  for (let i = 0; i < 14; i++) {
    await page.mouse.wheel(0, -100);
    await page.waitForTimeout(30);
  }
  await expect(page.getByRole('button', { name: 'Zoom preview in', exact: true })).toBeDisabled();
  const clamped = await screenPoint(page);
  await page.mouse.wheel(0, -100);
  expect(Math.abs((await screenPoint(page)).x - clamped.x)).toBeLessThan(0.1);
  await page.getByRole('button', { name: 'Fit preview to screen', exact: true }).click();
  expect(Math.abs((await screenPoint(page)).x - initial.x)).toBeLessThan(0.1);
  expect(Math.abs((await screenPoint(page)).y - initial.y)).toBeLessThan(0.1);
  await expect(page.locator('[data-editor-document-state]')).toHaveText('Saved');
});

test('pinch follows its centroid and continues panning after one finger lifts', async ({ page, context }) => {
  await openRectangle(page);
  const initial = await screenPoint(page);
  const cdp = await context.newCDPSession(page);
  const touch = async (type: 'touchStart' | 'touchMove' | 'touchEnd', spread: number, shift = 0, single = false) => {
    await cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [
        { x: initial.x - spread + shift, y: initial.y, id: 1 },
        ...(single ? [] : [{ x: initial.x + spread + shift, y: initial.y, id: 2 }])
      ]
    });
  };
  await touch('touchStart', 30);
  await touch('touchMove', 60, 20);
  await expect.poll(async () => Math.abs((await screenPoint(page)).x - initial.x - 20)).toBeLessThan(1);
  await expect.poll(async () => Math.abs((await screenPoint(page)).y - initial.y)).toBeLessThan(1);
  await page.locator('svg[aria-label="UPID path preview"]').evaluate((svg, point) => {
    const remaining = new Touch({ identifier: 1, target: svg, clientX: point.x - 40, clientY: point.y });
    const lifted = new Touch({ identifier: 2, target: svg, clientX: point.x + 80, clientY: point.y });
    svg.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [remaining], changedTouches: [lifted] }));
  }, initial);
  const beforePan = await screenPoint(page);
  await page.locator('svg[aria-label="UPID path preview"]').evaluate((svg, point) => {
    const remaining = new Touch({ identifier: 1, target: svg, clientX: point.x - 10, clientY: point.y });
    svg.dispatchEvent(new TouchEvent('touchmove', { bubbles: true, cancelable: true, touches: [remaining], changedTouches: [remaining] }));
  }, initial);
  await expect.poll(async () => Math.abs((await screenPoint(page)).x - beforePan.x - 30)).toBeLessThan(1);
  await touch('touchEnd', 0);
  await expect(page.locator('[data-editor-document-state]')).toHaveText('Saved');
});


