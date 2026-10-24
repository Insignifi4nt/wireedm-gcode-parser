import { expect, test } from '@playwright/test';
import { confirmPendingDxfImport } from './dxf-import';
import { openReadyWorkbench } from './fixtures/workbench';

for (const width of [1440, 393]) {
  test(`first-run workbench at ${width}px imports directly from its illustrated empty library`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openReadyWorkbench(page);
    const empty = page.locator('[data-workbench-empty="library"]');
    await expect(empty.getByRole('heading', { name: 'No saved projects yet' })).toBeVisible();
    const image = empty.getByRole('img');
    await expect(image).toHaveJSProperty('naturalWidth', 1659);
    await expect(image).toHaveCSS('object-fit', 'contain');
    await expect(page.getByRole('button', { name: 'Design in CAD', exact: true })).toBeEnabled();
    await expect(page.locator('[data-app-header]')).not.toHaveAttribute('inert');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `tmp/agent-feedback/empty-library-${width}.png`, fullPage: true });
    await page.getByLabel('DXF file', { exact: true }).setInputFiles('tests/fixtures/machine-packages/robofil-100-v2/no-lead-rectangle.dxf');
    await confirmPendingDxfImport(page);
    await page.getByRole('button', { name: 'Back to Dashboard', exact: true }).click();
    await expect(page.getByRole('list', { name: 'Project list' }).getByRole('listitem')).toHaveCount(1);
    await expect(empty).toHaveCount(0);
    await page.getByRole('button', { name: 'Search projects', exact: true }).click();
    await page.getByRole('searchbox', { name: 'Search projects', exact: true }).fill('unmatched-query');
    await expect(page.getByText('No projects match the active filters.', { exact: false })).toBeVisible();
    await expect(empty).toHaveCount(0);
    await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
    await expect(page.getByRole('list', { name: 'Project list' }).getByRole('listitem')).toHaveCount(1);
  });
}

test('empty editor preview uses the illustration and keeps dashboard navigation immediately usable', async ({ page }) => {
  await openReadyWorkbench(page);
  await page.getByRole('button', { name: 'Open Editor', exact: true }).click();
  await expect(page.locator('[data-workbench-empty="preview"]')).toContainText('No drawable toolpath loaded');
  await page.getByRole('button', { name: 'Back to Dashboard', exact: true }).click();
  await expect(page.locator('[data-workbench-empty="library"]')).toBeVisible();
  await expect(page.getByLabel('Machine program file', { exact: true })).toBeEnabled();
});

test('slow artwork uses a reduced-motion skeleton while real import controls stay ready', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  let finishImage: () => void = () => {};
  const imageGate = new Promise<void>(resolve => { finishImage = resolve; });
  await page.route('**/cad-cam-design-to-part*.png', async route => {
    await imageGate;
    await route.continue();
  });
  try {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByLabel('DXF file', { exact: true })).toBeEnabled();
    const empty = page.locator('[data-workbench-empty="library"]');
    await expect(empty.locator('[data-empty-image-skeleton]')).toBeVisible();
    await expect(empty.locator('[data-empty-image-skeleton]')).toHaveCSS('animation-name', 'none');
    await expect(empty.locator('[aria-busy="true"]')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Design in CAD', exact: true })).toBeEnabled();
    finishImage();
    await expect(empty.getByRole('img')).toHaveJSProperty('naturalWidth', 1659);
    await expect(empty.locator('[data-empty-image-skeleton]')).toHaveCount(0);
    await expect(empty.locator('[aria-busy="true"]')).toHaveCount(0);
  } finally {
    finishImage();
  }
});

test('failed artwork leaves useful empty guidance and import controls without a permanent skeleton', async ({ page }) => {
  await page.route('**/cad-cam-design-to-part*.png', route => route.abort());
  await openReadyWorkbench(page);
  const empty = page.locator('[data-workbench-empty="library"]');
  await expect(empty.locator('[data-image-state="failed"]')).toBeHidden();
  await expect(empty.locator('[data-empty-image-skeleton]')).toHaveCount(0);
  await expect(empty.getByRole('heading', { name: 'No saved projects yet' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Design in CAD', exact: true })).toBeEnabled();
  await expect(page.getByLabel('Machine program file', { exact: true })).toBeEnabled();
});
