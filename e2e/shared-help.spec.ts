import { expect, test, type Locator, type Page } from '@playwright/test';
import { prepareCadTools } from './cad-tool-helpers';
import { openReadyWorkbench } from './fixtures/workbench';

async function box(locator: Locator) {
  const found = await locator.boundingBox();
  if (!found) throw new Error('Missing box');
  return found;
}

/** Shown help is the topmost element where it appears, yet a press there reaches the control underneath. */
async function layering(page: Page) {
  return page.evaluate(() => {
    const help = document.querySelector<HTMLElement>('[role="tooltip"]'), wrapper = help?.parentElement;
    if (!help || !wrapper) throw new Error('Missing help');
    const area = help.getBoundingClientRect(), x = area.x + area.width / 2, y = area.y + area.height / 2;
    const pressed = document.elementFromPoint(x, y);
    help.style.pointerEvents = wrapper.style.pointerEvents = 'auto';
    const shown = document.elementFromPoint(x, y);
    help.style.pointerEvents = wrapper.style.pointerEvents = '';
    return { onTop: !!shown && help.contains(shown), pressReachesControl: !!pressed && !wrapper.contains(pressed) };
  });
}

test('shared help opens beside its control inside the viewport and leaves presses to the controls below', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openReadyWorkbench(page);
  const help = page.getByRole('tooltip');
  const about = page.getByRole('button', { name: 'About design and manufacturing' });
  await about.hover();
  await expect(help).toHaveText(/^Parametric sketches/);
  await expect(about).toHaveAccessibleDescription(/^Parametric sketches/);
  const aboutBox = await box(about), aboutHelp = await box(help);
  expect(Math.abs(aboutBox.y - (aboutHelp.y + aboutHelp.height) - 6)).toBeLessThanOrEqual(1);
  expect(aboutHelp.x).toBeLessThan(aboutBox.x + aboutBox.width / 2);
  expect(aboutHelp.x + aboutHelp.width).toBeGreaterThan(aboutBox.x + aboutBox.width / 2);
  expect(await layering(page)).toEqual({ onTop: true, pressReachesControl: true });

  // Help for a control in the top corner opens below it, kept inside the viewport.
  const settings = page.getByRole('button', { name: 'Open settings' });
  await settings.hover();
  await expect(help).toHaveCount(1);
  await expect(help).toHaveText('Settings');
  const settingsBox = await box(settings), settingsHelp = await box(help);
  expect(Math.abs(settingsHelp.y - (settingsBox.y + settingsBox.height) - 6)).toBeLessThanOrEqual(1);
  expect(settingsHelp.x + settingsHelp.width).toBeLessThanOrEqual(1440 - 8 + 0.5);

  await page.mouse.move(700, 880);
  await expect(help).toHaveCount(0);
  await about.focus();
  await expect(help).toHaveText(/^Parametric sketches/);
  await page.keyboard.press('Escape');
  await expect(help).toHaveCount(0);
  await expect(about).toBeFocused();
  await expect(about).not.toHaveAttribute('aria-describedby');
});

test('shared help closes when its control scrolls', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 420 });
  await openReadyWorkbench(page);
  const about = page.getByRole('button', { name: 'About machine programs' });
  await about.focus();
  const help = page.getByRole('tooltip');
  await expect(help).toHaveText(/^Open \.GCODE/);
  const before = await box(about);
  await page.mouse.move(700, 300);
  await page.mouse.wheel(0, 120);
  await expect.poll(async () => (await box(about)).y).toBeLessThan(before.y);
  await expect(help).toHaveCount(0);
});

test('menu item help opens beside its item above the menu', async ({ page }) => {
  await prepareCadTools(page);
  await page.getByRole('button', { name: 'Design in CAD' }).click();
  await page.getByRole('button', { name: 'File', exact: true }).click();
  const item = page.getByRole('menuitem', { name: 'Section for CAM' });
  await item.hover();
  const help = page.getByRole('tooltip');
  await expect(help).toHaveText(/^Create CAM geometry/);
  const itemBox = await box(item), itemHelp = await box(help);
  expect(itemHelp.x + itemHelp.width <= itemBox.x + 0.5 || itemHelp.x >= itemBox.x + itemBox.width - 0.5).toBe(true);
  expect(itemHelp.x).toBeGreaterThanOrEqual(8 - 0.5);
  expect(itemHelp.x + itemHelp.width).toBeLessThanOrEqual(1440 - 8 + 0.5);
  expect(await layering(page)).toEqual({ onTop: true, pressReachesControl: true });
  await expect(page.getByRole('menu')).toBeVisible();
});
